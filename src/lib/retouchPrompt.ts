export type RetouchStrength = "subtle" | "balanced" | "strong";
export type EditArea = "jawAndCheeks" | "skinOnly" | "fullFace";
export type QualityMode = "fast" | "standard" | "best";

export type MaskSettings = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  feather: number;
};

export type RetouchParams = {
  faceSlimming: number;
  jawline: number;
  skin: number;
  underEye: number;
  identityLock: boolean;
  strength: RetouchStrength;
  editArea: EditArea;
  qualityMode: QualityMode;
  candidateCount: number;
  useMask: boolean;
  mask: MaskSettings;
};

export const DEFAULT_MASK_SETTINGS: MaskSettings = {
  centerX: 0.5,
  centerY: 0.62,
  width: 0.42,
  height: 0.28,
  feather: 0.12,
};

export const DEFAULT_RETOUCH_PARAMS: RetouchParams = {
  faceSlimming: 6,
  jawline: 8,
  skin: 18,
  underEye: 12,
  identityLock: true,
  strength: "subtle",
  editArea: "jawAndCheeks",
  qualityMode: "standard",
  candidateCount: 3,
  useMask: true,
  mask: DEFAULT_MASK_SETTINGS,
};

const retouchStrengths = ["subtle", "balanced", "strong"] as const;
const editAreas = ["jawAndCheeks", "skinOnly", "fullFace"] as const;
const qualityModes = ["fast", "standard", "best"] as const;

const legacyFaceSlimmingValues: Record<string, number> = {
  none: 0,
  subtle: 6,
  medium: 10,
  strong: 14,
};

const legacyJawlineValues: Record<string, number> = {
  none: 0,
  natural: 8,
  defined: 12,
};

const legacySkinValues: Record<string, number> = {
  unchanged: 0,
  clean: 18,
  brighten: 20,
  polished: 24,
};

const legacyQualityModes: Record<string, QualityMode> = {
  preview: "fast",
  standard: "standard",
  high: "best",
};

type PromptMode = "generate" | "refine";

export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}

export function normalizeCandidateCount(value: unknown) {
  return Math.round(
    clampNumber(value, 1, 3, DEFAULT_RETOUCH_PARAMS.candidateCount),
  );
}

export function normalizeQualityMode(value: unknown): QualityMode {
  if (typeof value !== "string") {
    return DEFAULT_RETOUCH_PARAMS.qualityMode;
  }

  if (isOneOf(value, qualityModes)) {
    return value;
  }

  return legacyQualityModes[value] ?? DEFAULT_RETOUCH_PARAMS.qualityMode;
}

export function normalizeMaskSettings(input: unknown): MaskSettings {
  const source: Record<string, unknown> =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  return {
    centerX: clampNumber(source.centerX, 0.2, 0.8, DEFAULT_MASK_SETTINGS.centerX),
    centerY: clampNumber(source.centerY, 0.35, 0.85, DEFAULT_MASK_SETTINGS.centerY),
    width: clampNumber(source.width, 0.18, 0.7, DEFAULT_MASK_SETTINGS.width),
    height: clampNumber(source.height, 0.12, 0.55, DEFAULT_MASK_SETTINGS.height),
    feather: clampNumber(source.feather, 0.02, 0.3, DEFAULT_MASK_SETTINGS.feather),
  };
}

export function normalizeRetouchParams(input: unknown): RetouchParams {
  const source =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  return {
    faceSlimming: normalizeNumberControl(
      source.faceSlimming,
      DEFAULT_RETOUCH_PARAMS.faceSlimming,
      legacyFaceSlimmingValues,
    ),
    jawline: normalizeNumberControl(
      source.jawline,
      DEFAULT_RETOUCH_PARAMS.jawline,
      legacyJawlineValues,
    ),
    skin: normalizeNumberControl(
      source.skin,
      DEFAULT_RETOUCH_PARAMS.skin,
      legacySkinValues,
    ),
    underEye: normalizeNumberControl(
      source.underEye,
      DEFAULT_RETOUCH_PARAMS.underEye,
    ),
    identityLock: normalizeBoolean(
      source.identityLock,
      DEFAULT_RETOUCH_PARAMS.identityLock,
      { trueValues: ["strict"], falseValues: ["balanced"] },
    ),
    strength: isOneOf(source.strength, retouchStrengths)
      ? source.strength
      : DEFAULT_RETOUCH_PARAMS.strength,
    editArea: isOneOf(source.editArea, editAreas)
      ? source.editArea
      : DEFAULT_RETOUCH_PARAMS.editArea,
    qualityMode: normalizeQualityMode(source.qualityMode),
    candidateCount: normalizeCandidateCount(source.candidateCount),
    useMask: normalizeBoolean(source.useMask, DEFAULT_RETOUCH_PARAMS.useMask),
    mask: normalizeMaskSettings(source.mask),
  };
}

export function compileRetouchPrompt(
  params: RetouchParams,
  refinementInstruction?: string,
  mode: PromptMode = refinementInstruction ? "refine" : "generate",
): string {
  const normalizedParams = normalizeRetouchParams(params);
  const maskedLowerFaceEdit =
    normalizedParams.useMask && normalizedParams.editArea === "jawAndCheeks";
  const trimmedRefinementInstruction = refinementInstruction?.trim();
  const sections = [
    coreInstruction,
    normalizedParams.identityLock ? identityLockInstruction : "",
    protectedAreasInstruction,
    retouchPhilosophyInstruction,
    getEditAreaInstruction(normalizedParams.editArea, maskedLowerFaceEdit),
    getControlInstruction(normalizedParams),
    getStrengthInstruction(normalizedParams.strength),
    negativeConstraintsInstruction,
    outputStyleInstruction,
  ].filter(Boolean);

  if (mode === "refine") {
    sections.push(refinementSafetyInstruction);
  }

  if (trimmedRefinementInstruction) {
    sections.push(
      `Requested micro-adjustment: ${trimmedRefinementInstruction} Make the smallest possible edit. If the requested change would alter identity, ignore that part.`,
    );
  }

  return sections.join("\n\n");
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function normalizeNumberControl(
  value: unknown,
  fallback: number,
  legacyValues?: Record<string, number>,
) {
  if (typeof value === "string" && legacyValues?.[value] !== undefined) {
    return legacyValues[value];
  }

  return Math.round(clampNumber(value, 0, 100, fallback));
}

function normalizeBoolean(
  value: unknown,
  fallback: boolean,
  legacy?: { trueValues?: string[]; falseValues?: string[] },
) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || legacy?.trueValues?.includes(String(value))) {
    return true;
  }

  if (value === "false" || legacy?.falseValues?.includes(String(value))) {
    return false;
  }

  return fallback;
}

const coreInstruction =
  "Edit this portrait photo with ultra-conservative, identity-preserving retouching. The result must look like the exact same person in the exact same photo, only slightly fresher and better rested.";

const identityLockInstruction =
  "Preserve the person's identity with maximum fidelity. Do not change facial bone structure, face width, face length, eye shape, eye size, nose shape, mouth shape, lips, teeth, eyebrows, forehead, hairline, ears, age, gender presentation, ethnicity, expression, gaze direction, camera angle, or head pose.";

const protectedAreasInstruction =
  "Do not alter the background, clothing, accessories, body, hairstyle, hairline, hands, lighting direction, shadows, camera perspective, focal length, image texture, or overall composition.";

const retouchPhilosophyInstruction =
  "This is not a transformation. This is not plastic surgery. This is not face reshaping. This is a subtle photo retouch. Keep natural skin texture, pores, asymmetry, and realistic imperfections.";

const negativeConstraintsInstruction =
  "Do not beautify by inventing new features. Do not make the person look like a model, celebrity, doll, anime character, younger person, different ethnicity, or different face. Avoid waxy skin, airbrushing, over-smoothing, fake HDR, plastic texture, and AI-generated facial features.";

const outputStyleInstruction =
  "Photorealistic edit. Preserve the original image's realism, grain, sharpness level, lighting, color temperature, and camera quality. The edited image should look like a real lightly retouched photo, not a generated image.";

const refinementSafetyInstruction =
  "Refinement mode: Regenerate from the original uploaded photo, not from a generated candidate. Treat this as a micro-adjustment to the original-source retouch recipe. Do not compound lower-face changes. Do not change facial structure. Do not alter eyes, nose, mouth, lips, teeth, hairline, ears, background, clothing, lighting, or pose. Make the smallest possible edit needed for the requested refinement. If the refinement would change identity or facial structure, ignore that part and preserve the face.";

function getEditAreaInstruction(editArea: EditArea, maskedLowerFaceEdit: boolean) {
  if (editArea === "jawAndCheeks") {
    const baseInstruction =
      "Edit area: Jaw and cheeks only. Slightly reduce the visual impression of lower-face puffiness, very subtly soften heaviness in lower cheeks, and lightly improve existing jawline shadow. Do not redraw the jaw. Do not narrow the skull. Do not change chin shape. Do not change bone structure. Do not create a V-line. Do not make the face slimmer in a structural way.";

    if (!maskedLowerFaceEdit) {
      return `${baseInstruction} No mask is active, so be extra conservative and preserve all unrequested regions.`;
    }

    return `${baseInstruction} Only edit inside the masked lower-face area. Treat all unmasked regions as locked reference pixels. Do not modify the eyes, nose, mouth, lips, teeth, eyebrows, forehead, hairline, ears, hairstyle, neck, clothes, background, lighting, camera angle, or expression.`;
  }

  if (editArea === "skinOnly") {
    return "Edit area: Skin only. Only improve skin tone, minor blemishes, redness, oiliness, under-eye tiredness, and texture. Do not change face shape or facial features at all. Do not adjust cheeks, jaw, chin, eyes, nose, mouth, brows, or hairline.";
  }

  return "Edit area: Full face. Allow a gentle overall retouch, but full face still means conservative portrait retouching, not beautification or face redesign. Preserve identity, original facial structure, facial proportions, expression, and camera reality.";
}

function getControlInstruction(params: RetouchParams) {
  const lowerFaceInstruction =
    params.editArea === "skinOnly"
      ? "Lower-face puffiness controls must be ignored because skin only mode is selected."
      : `Lower-face puffiness control: ${params.faceSlimming}/100. Use this as a low ceiling for tonal freshness only, not structural slimming.`;

  return [
    "Use these controls as conservative ceilings, not as a reason to transform the face.",
    lowerFaceInstruction,
    `Existing jawline shadow refinement: ${params.jawline}/100. Keep contour tonal, local, and subtle.`,
    `Skin cleanup: ${params.skin}/100. Keep pores, natural texture, moles, freckles, and normal asymmetry unless they are temporary minor blemishes.`,
    `Under-eye freshness: ${params.underEye}/100. Reduce tiredness gently without changing eye shape, eye size, eyelids, gaze, or expression.`,
  ].join(" ");
}

function getStrengthInstruction(strength: RetouchStrength) {
  if (strength === "subtle") {
    return "Strength: Subtle. Apply minimal changes only. The result should be almost indistinguishable from the original at first glance. Maximum change level: 3-5% visual improvement.";
  }

  if (strength === "balanced") {
    return "Strength: Balanced. Apply a noticeable but still natural retouch. The person must remain unmistakably identical. Maximum change level: 6-10% visual improvement.";
  }

  return "Strength: Strong. Apply the strongest allowed SameFace retouch, but still preserve identity and original facial structure. Maximum change level: 10-15% visual improvement. Do not exceed this.";
}
