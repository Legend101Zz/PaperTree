import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// Get surrounding context from text
export function getTextContext(
  fullText: string,
  selectedText: string,
  contextLength: number = 50
): { prefix: string; suffix: string } {
  const index = fullText.indexOf(selectedText);
  if (index === -1) {
    return { prefix: "", suffix: "" };
  }

  const startPrefix = Math.max(0, index - contextLength);
  const endSuffix = Math.min(
    fullText.length,
    index + selectedText.length + contextLength
  );

  return {
    prefix: fullText.slice(startPrefix, index),
    suffix: fullText.slice(index + selectedText.length, endSuffix),
  };
}
