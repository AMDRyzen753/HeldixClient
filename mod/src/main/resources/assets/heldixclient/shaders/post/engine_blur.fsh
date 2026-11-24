#version 330
#extension GL_ARB_separate_shader_objects : require

// Heldix Shader-Engine: Gaußsche Unschärfe in eine Richtung (zwei Durchgänge = horizontal + vertikal).

uniform sampler2D InSampler;

layout(location = 0) in vec2 texCoord;
layout(location = 0) out vec4 fragColor;

layout(std140) uniform SamplerInfo {
    vec2 OutSize;
    vec2 InSize;
};

layout(std140) uniform HeldixBlur {
    vec2 Direction;
};

const float WEIGHTS[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

void main() {
    vec2 texel = Direction / InSize;
    vec3 color = texture(InSampler, texCoord).rgb * WEIGHTS[0];
    for (int i = 1; i < 5; i++) {
        vec2 offset = texel * float(i) * 1.5;
        color += texture(InSampler, texCoord + offset).rgb * WEIGHTS[i];
        color += texture(InSampler, texCoord - offset).rgb * WEIGHTS[i];
    }
    fragColor = vec4(color, 1.0);
}
