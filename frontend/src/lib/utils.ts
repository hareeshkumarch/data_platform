import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getOSShortcut(mac: string, win: string): string {
  if (typeof window !== "undefined") {
    return window.navigator.platform.toUpperCase().indexOf("MAC") >= 0 ? mac : win;
  }
  return mac;
}
