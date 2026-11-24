#version 330
#extension GL_ARB_separate_shader_objects : require

// Heldix Shader-Engine: setzt das Bild zusammen – Umgebungsverdeckung (SSAO), Tiefenunschärfe, Nebel und Bloom.
// Die Stärken und Kameradaten kommen aus einer kleinen Parameter-Textur, die HeldixClient jedes Bild füllt
// (dev.heldixclient.render.ShaderEngine), weil Post-Effekte sonst nur feste Werte aus der JSON kennen.

uniform sampler2D InSampler;
uniform sampler2D DepthSampler;
uniform sampler2D BloomSampler;
uniform sampler2D BlurSampler;
uniform sampler2D ParamsSampler;

layout(location = 0) in vec2 texCoord;
layout(location = 0) out vec4 fragColor;

layout(std140) uniform SamplerInfo {
    vec2 OutSize;
    vec2 InSize;
    vec2 DepthSize;
    vec2 BloomSize;
    vec2 BlurSize;
    vec2 ParamsSize;
};

const float NEAR = 0.05;
const float GOLDEN_ANGLE = 2.39996323;
const int AO_SAMPLES = 16;

vec4 param(int index) {
    return texelFetch(ParamsSampler, ivec2(index, 0), 0);
}

float unpack16(vec2 rg) {
    return floor(rg.x * 255.0 + 0.5) * 256.0 + floor(rg.y * 255.0 + 0.5);
}

float far;
bool zeroToOne;

// Minecraft 26.x nutzt umgekehrte Tiefe: nah = 1, fern = 0, Himmel = 0 (setPerspective mit vertauschtem near/far)
float linearDepth(float depth) {
    if (zeroToOne) {
        return NEAR * far / (depth * (far - NEAR) + NEAR);
    }
    float ndc = depth * 2.0 - 1.0;
    return 2.0 * NEAR * far / ((far - NEAR) * ndc + (far + NEAR));
}

float depthAt(vec2 uv) {
    return linearDepth(texture(DepthSampler, uv).r);
}

// geordnetes 4×4-Muster pro Pixel: dreht die SSAO-Abtastpunkte, wirkt ruhiger als Zufallsrauschen
float noise(vec2 pixel) {
    ivec2 p = ivec2(mod(pixel, 4.0));
    int index = p.x + p.y * 4;
    const float BAYER[16] = float[](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return (BAYER[index] + 0.5) / 16.0;
}

float ambientOcclusion(float center, float tanHalfFov) {
    // Radius ~0.7 Blöcke, auf den Bildschirm umgerechnet
    float radius = clamp(0.7 * OutSize.y / (2.0 * tanHalfFov * center), 3.0, 48.0);
    float rotation = noise(gl_FragCoord.xy) * 6.2831853;
    float occlusion = 0.0;
    for (int i = 0; i < AO_SAMPLES; i++) {
        float t = (float(i) + 0.5) / float(AO_SAMPLES);
        float angle = float(i) * GOLDEN_ANGLE + rotation;
        vec2 offset = vec2(cos(angle), sin(angle)) * sqrt(t) * radius / OutSize;
        float sampleDepth = depthAt(texCoord + offset);
        float diff = center - sampleDepth;
        // näher als die Mitte = verdeckt; sehr große Unterschiede (Kanten vor dem Himmel) zählen nicht
        occlusion += smoothstep(0.03, 0.25, diff) * (1.0 - smoothstep(1.2, 3.0, diff));
    }
    return 1.0 - occlusion / float(AO_SAMPLES);
}

void main() {
    vec4 strengths = param(0);           // Bloom, Tiefenunschärfe, Nebel, SSAO
    vec4 camera = param(1);              // Sichtweite (16 Bit), 0..1-Tiefe, Unterwasser
    vec4 fogColor = param(2);            // Nebelfarbe
    vec4 lens = param(3);                // tan(Sichtfeld/2) (16 Bit), Ende des Sichtweiten-Nebels (16 Bit)
    far = max(unpack16(camera.rg) / 16.0, 16.0);
    zeroToOne = camera.b > 0.5;
    bool underwater = camera.a > 0.5;
    float tanHalfFov = max(unpack16(lens.rg) / 16384.0, 0.05);
    float fogEnd = max(unpack16(lens.ba) / 16.0, 16.0);

    vec3 color = texture(InSampler, texCoord).rgb;
    float rawDepth = texture(DepthSampler, texCoord).r;
    bool sky = rawDepth <= 1e-7;
    float depth = sky ? far * 4.0 : linearDepth(rawDepth);

    // Umgebungsverdeckung
    // nur in der Nähe: weiter weg verschwimmt Minecraft die Landschaft im Nebel, dort würde SSAO sie wieder hervorholen
    float aoFade = 1.0 - smoothstep(fogEnd * 0.45, fogEnd * 0.75, depth);
    if (strengths.a > 0.0 && !sky && aoFade > 0.0) {
        float ao = ambientOcclusion(depth, tanHalfFov);
        color *= mix(1.0, ao, strengths.a * aoFade);
    }

    // Tiefenunschärfe: alles hinter dem Punkt in der Bildmitte wird weicher
    if (strengths.g > 0.0) {
        float focus = min(depthAt(vec2(0.5)), depthAt(vec2(0.47, 0.5)));
        focus = min(focus, depthAt(vec2(0.53, 0.5)));
        float behind = max(depth - focus, 0.0);
        float amount = clamp(behind / (focus * 1.5 + 6.0), 0.0, 1.0);
        color = mix(color, texture(BlurSampler, texCoord).rgb, amount * strengths.g);
    }

    // Nebel: Dunst, der mit der Entfernung dichter wird (nicht unter Wasser/in Lava, dort macht Minecraft eigenen Nebel)
    if (strengths.b > 0.0 && !underwater) {
        // Himmel bleibt, wie er ist; Gelände nähert sich der Nebelfarbe von Minecraft (am Horizont also nahtlos)
        float distanceFactor = sky ? 0.0 : clamp((depth - 12.0) / (fogEnd * 0.8), 0.0, 1.0);
        float haze = (1.0 - exp(-distanceFactor * 2.5)) * strengths.b * 0.8;
        color = mix(color, fogColor.rgb, haze);
    }

    // Bloom: helle Stellen leuchten über ihre Umgebung
    if (strengths.r > 0.0) {
        color += texture(BloomSampler, texCoord).rgb * strengths.r * 1.4;
    }

    fragColor = vec4(color, 1.0);
}
