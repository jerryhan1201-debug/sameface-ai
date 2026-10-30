import { NextResponse } from "next/server";
import OpenAI, { APIError, toFile } from "openai";

import {
  compileRetouchPrompt,
  normalizeRetouchParams,
  type QualityMode,
  type RetouchParams,
} from "@/lib/retouchPrompt";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_MASK_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_REFINEMENT_INSTRUCTION_LENGTH = 500;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const OUTPUT_FORMAT = "jpeg";

type ApiQuality = "low" | "medium" | "high" | "auto";
type RefineMode = "regenerateFromOriginal";

export type RetouchCandidateImage = {
  id: string;
  b64_json: string;
  label: string;
};

export type RetouchResult = {
  id: string;
  name: string;
  finish: string;
  imageUrl: string;
};

type RetouchSuccessResponse = {
  success: true;
  prompt: string;
  params: RetouchParams;
  images: RetouchCandidateImage[];
  image: RetouchCandidateImage;
  results: RetouchResult[];
  maskApplied: boolean;
  refineMode: RefineMode;
};

type RetouchErrorResponse = {
  success: false;
  error: string;
};

type ParsedRetouchForm = {
  image: File;
  identityImage: File | null;
  mask: File | null;
  params: RetouchParams;
  refinementInstruction?: string;
  refineMode: RefineMode;
};

export function mapQualityModeToApiQuality(mode: QualityMode): ApiQuality {
  if (mode === "fast") {
    return "low";
  }

  if (mode === "standard") {
    return "medium";
  }

  if (mode === "best") {
    return "high";
  }

  return "medium";
}

function jsonError(error: string, status: number) {
  return NextResponse.json<RetouchErrorResponse>(
    { success: false, error },
    { status },
  );
}

function getOpenAIErrorMessage(error: unknown) {
  if (error instanceof APIError) {
    return error.message || "OpenAI image edit request failed.";
  }

  if (error instanceof Error) {
    return error.message || "OpenAI image edit request failed.";
  }

  return "OpenAI image edit request failed.";
}

function validateImageFile(image: File, label: string) {
  if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
    return jsonError(`${label} must be a JPEG, PNG, or WEBP file.`, 400);
  }

  if (image.size > MAX_IMAGE_SIZE_BYTES) {
    return jsonError(`${label} must be smaller than 10MB.`, 400);
  }

  return null;
}

function validateMaskFile(mask: File) {
  if (mask.type !== "image/png") {
    return jsonError("Mask must be a PNG file.", 400);
  }

  if (mask.size > MAX_MASK_SIZE_BYTES) {
    return jsonError("Mask must be smaller than 4MB.", 400);
  }

  return null;
}

function parseParams(paramsValue: FormDataEntryValue | null) {
  if (typeof paramsValue !== "string") {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(paramsValue);

    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseRefineMode(value: FormDataEntryValue | null): RefineMode {
  if (value === "regenerateFromOriginal" || value === null) {
    return "regenerateFromOriginal";
  }

  return "regenerateFromOriginal";
}

async function parseRetouchForm(
  request: Request,
  requiresRefinementInstruction: boolean,
) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonError("Request must be multipart form data.", 400);
  }

  const image = formData.get("image");
  const identityImage = formData.get("identityImage");
  const mask = formData.get("mask");
  const paramsValue = formData.get("params");
  const qualityModeValue = formData.get("qualityMode");
  const candidateCountValue = formData.get("candidateCount");
  const refinementInstructionValue = formData.get("refinementInstruction");
  const refineModeValue = formData.get("refineMode");

  if (!(image instanceof File)) {
    return jsonError("Original image file is required.", 400);
  }

  const imageError = validateImageFile(image, "Original image");

  if (imageError) {
    return imageError;
  }

  if (identityImage !== null && !(identityImage instanceof File)) {
    return jsonError("Identity reference must be an image file.", 400);
  }

  if (identityImage instanceof File) {
    const identityImageError = validateImageFile(
      identityImage,
      "Identity reference",
    );

    if (identityImageError) {
      return identityImageError;
    }
  }

  if (mask !== null && !(mask instanceof File)) {
    return jsonError("Mask must be a PNG file.", 400);
  }

  if (mask instanceof File) {
    const maskError = validateMaskFile(mask);

    if (maskError) {
      return maskError;
    }
  }

  const paramsInput = parseParams(paramsValue);

  if (typeof qualityModeValue === "string") {
    paramsInput.qualityMode = qualityModeValue;
  }

  if (typeof candidateCountValue === "string") {
    paramsInput.candidateCount = candidateCountValue;
  }

  const params = normalizeRetouchParams(paramsInput);
  const refineMode = parseRefineMode(refineModeValue);

  if (
    requiresRefinementInstruction &&
    refineModeValue !== null &&
    refineModeValue !== "regenerateFromOriginal"
  ) {
    return jsonError(
      "Direct generated-image refine is disabled. Use regenerateFromOriginal.",
      400,
    );
  }

  if (!requiresRefinementInstruction) {
    return {
      image,
      identityImage: identityImage instanceof File ? identityImage : null,
      mask: mask instanceof File ? mask : null,
      params,
      refineMode,
    } satisfies ParsedRetouchForm;
  }

  if (typeof refinementInstructionValue !== "string") {
    return jsonError("Refinement instruction string is required.", 400);
  }

  const refinementInstruction = refinementInstructionValue.trim();

  if (!refinementInstruction) {
    return jsonError("Refinement instruction cannot be empty.", 400);
  }

  if (refinementInstruction.length > MAX_REFINEMENT_INSTRUCTION_LENGTH) {
    return jsonError(
      "Refinement instruction must be 500 characters or less.",
      400,
    );
  }

  return {
    image,
    identityImage: identityImage instanceof File ? identityImage : null,
    mask: mask instanceof File ? mask : null,
    params,
    refinementInstruction,
    refineMode,
  } satisfies ParsedRetouchForm;
}

async function createImageInput(image: File, identityImage: File | null) {
  const currentImage = await toFile(image, image.name, {
    type: image.type,
  });

  if (!identityImage) {
    return currentImage;
  }

  const identityReference = await toFile(identityImage, identityImage.name, {
    type: identityImage.type,
  });

  return [currentImage, identityReference];
}

async function createMaskInput(mask: File | null) {
  if (!mask) {
    return undefined;
  }

  return toFile(mask, mask.name || "sameface-mask.png", {
    type: "image/png",
  });
}

export async function handleRetouchRequest(
  request: Request,
  options: {
    requiresRefinementInstruction: boolean;
    resultId: string;
    resultName: string;
    resultFinish: string;
  },
) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return jsonError("OPENAI_API_KEY is not configured on the server.", 500);
  }

  const parsed = await parseRetouchForm(
    request,
    options.requiresRefinementInstruction,
  );

  if (parsed instanceof NextResponse) {
    return parsed;
  }

  const shouldApplyMask =
    parsed.params.useMask &&
    parsed.params.editArea === "jawAndCheeks" &&
    parsed.mask !== null;

  if (
    parsed.params.useMask &&
    parsed.params.editArea === "jawAndCheeks" &&
    !parsed.mask
  ) {
    return jsonError(
      "Mask PNG is required when useMask is enabled for Jaw & cheeks.",
      400,
    );
  }

  // Masking is guidance, not pixel-perfect segmentation; keep prompts conservative.
  // Direct generated-image refine remains intentionally disabled by default because it compounds face drift.
  const prompt = compileRetouchPrompt(
    parsed.params,
    parsed.refinementInstruction,
    options.requiresRefinementInstruction ? "refine" : "generate",
  );
  const apiQuality = mapQualityModeToApiQuality(parsed.params.qualityMode);
  const openai = new OpenAI({ apiKey });

  console.info("[SameFace retouch] request", {
    normalizedParams: parsed.params,
    editArea: parsed.params.editArea,
    strength: parsed.params.strength,
    qualityMode: parsed.params.qualityMode,
    mappedApiQuality: apiQuality,
    candidateCount: parsed.params.candidateCount,
    useMask: parsed.params.useMask,
    maskApplied: shouldApplyMask,
    maskSettings: parsed.params.mask,
    refineMode: parsed.refineMode,
    promptLength: prompt.length,
  });

  try {
    const edit = await openai.images.edit({
      model: "gpt-image-1",
      image: await createImageInput(parsed.image, parsed.identityImage),
      mask: await createMaskInput(shouldApplyMask ? parsed.mask : null),
      prompt,
      n: parsed.params.candidateCount,
      quality: apiQuality,
      input_fidelity: "high",
      output_format: OUTPUT_FORMAT,
      size: "auto",
    });

    const images: RetouchCandidateImage[] =
      edit.data
        ?.map((image, index) => ({
          id: `candidate-${index + 1}`,
          b64_json: image.b64_json ?? "",
          label: `Candidate ${index + 1}`,
        }))
        .filter((image) => image.b64_json) ?? [];

    if (images.length === 0) {
      return jsonError("OpenAI did not return an edited image.", 502);
    }

    const results: RetouchResult[] = images.map((image, index) => ({
      id: `${options.resultId}-${index + 1}`,
      name:
        images.length === 1
          ? options.resultName
          : `${options.resultName} ${index + 1}`,
      finish: options.resultFinish,
      imageUrl: `data:image/${OUTPUT_FORMAT};base64,${image.b64_json}`,
    }));

    return NextResponse.json<RetouchSuccessResponse>({
      success: true,
      prompt,
      params: parsed.params,
      images,
      image: images[0],
      results,
      maskApplied: shouldApplyMask,
      refineMode: parsed.refineMode,
    });
  } catch (error) {
    return jsonError(getOpenAIErrorMessage(error), 502);
  }
}
