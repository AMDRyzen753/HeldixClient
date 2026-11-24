#version 330
#extension GL_ARB_separate_shader_objects : require

// Heldix Shader-Engine: verkleinert das Bild (4 Abtastungen) für Bloom und Tiefenunschärfe.
// Mode 0 = nur helle Stellen (Bloom), Mode 1 = ganzes Bild (Unschärfe).

uniform sampler2D InSampler;
uniform sampler2D DepthSampler;
uniform sampler2D ParamsSampler;

layout(location = 0) in vec2 texCoord;
layout(location = 0) out vec4 fragColor;

layout(std140) uniform SamplerInfo {
    vec2 OutSize;
    vec2 InSize;
    vec2 DepthSize;
    vec2 ParamsSize;
};

layout(std140) uniform HeldixDown {
    float Mode;
    float Threshold;
};

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float NEAR = 0.05;

float unpack16(vec2 rg) {
    return floor(rg.x * 255.0 + 0.5) * 256.0 + floor(rg.y * 255.0 + 0.5);
}

// Entfernung in Blöcken; Minecraft 26.x nutzt umgekehrte Tiefe (nah = 1, fern = 0)
float linearDepth(float depth, float far, bool zeroToOne) {
    if (zeroToOne) return NEAR * far / (depth * (far - NEAR) + NEAR);
    float ndc = depth * 2.0 - 1.0;
    return 2.0 * NEAR * far / ((far - NEAR) * ndc + (far + NEAR));
}

void main() {
    // Abstand eines Ziel-Pixels in Quellkoordinaten
    vec2 px = 0.5 / OutSize;
    vec3 color = texture(InSampler, texCoord + vec2(-px.x, -px.y)).rgb
               + texture(InSampler, texCoord + vec2( px.x, -px.y)).rgb
               + texture(InSampler, texCoord + vec2(-px.x,  px.y)).rgb
               + texture(InSampler, texCoord + vec2( px.x,  px.y)).rgb;
    color *= 0.25;

    if (Mode < 0.5) {
        float luma = dot(color, LUMA);
        // weiche Schwelle, damit nichts hart abreißt
        float knee = 0.18;
        float soft = clamp(luma - Threshold + knee, 0.0, 2.0 * knee);
        soft = soft * soft / (4.0 * knee + 1e-4);
        float contribution = max(soft, luma - Threshold) / max(luma, 1e-4);
        // Himmel und ferne, schon im Nebel verblassende Landschaft leuchten nur schwach –
        // sonst wird der Horizont milchig und ausgeblendete Berge tauchen wieder auf
        vec4 camera = texelFetch(ParamsSampler, ivec2(1, 0), 0);
        float far = max(unpack16(camera.rg) / 16.0, 16.0);
        float depth = texture(DepthSampler, texCoord).r;
        float fogEnd = max(unpack16(texelFetch(ParamsSampler, ivec2(3, 0), 0).ba) / 16.0, 16.0);
        float distant = depth <= 1e-7 ? 1.0 : smoothstep(fogEnd * 0.45, fogEnd * 0.75, linearDepth(depth, far, camera.b > 0.5));
        color *= contribution * mix(1.0, 0.2, distant);
    }
    fragColor = vec4(color, 1.0);
}
