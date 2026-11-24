#version 330
#extension GL_ARB_separate_shader_objects : require

// HeldixClient-Shader: Schärfe, Farbkorrektur, Farbstufen und Vignette in einem Durchgang.
// Die Werte je Stil stehen in assets/heldixclient/post_effect/<stil>.json.

uniform sampler2D InSampler;

layout(location = 0) in vec2 texCoord;

layout(std140) uniform SamplerInfo {
    vec2 OutSize;
    vec2 InSize;
};

layout(std140) uniform HeldixGrade {
    vec4 Tint;        // rgb: Farbfaktoren (1 = unverändert)
    float Saturation; // 1 = unverändert, 0 = Graustufen
    float Contrast;   // 1 = unverändert
    float Brightness; // wird addiert, 0 = unverändert
    float Vignette;   // Abdunkeln der Ecken, 0 = aus
    float Sharpen;    // Nachschärfen, 0 = aus
    float Levels;     // Farbstufen pro Kanal, 0 = aus
};

layout(location = 0) out vec4 fragColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
    vec3 color = texture(InSampler, texCoord).rgb;

    if (Sharpen > 0.0) {
        vec2 texel = 1.0 / InSize;
        vec3 neighbours = texture(InSampler, texCoord + vec2(texel.x, 0.0)).rgb
                        + texture(InSampler, texCoord - vec2(texel.x, 0.0)).rgb
                        + texture(InSampler, texCoord + vec2(0.0, texel.y)).rgb
                        + texture(InSampler, texCoord - vec2(0.0, texel.y)).rgb;
        color = clamp(color + (color - neighbours * 0.25) * Sharpen, 0.0, 1.0);
    }

    color *= Tint.rgb;
    color = mix(vec3(dot(color, LUMA)), color, Saturation);
    color = (color - 0.5) * Contrast + 0.5 + Brightness;

    if (Levels > 0.0) {
        color = floor(color * Levels + 0.5) / Levels;
    }

    if (Vignette > 0.0) {
        float edge = smoothstep(0.35, 0.85, length(texCoord - 0.5) * 1.4142);
        color *= 1.0 - Vignette * edge;
    }

    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
