export const IS_PROD = process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
export const IS_DEV = process.env.NEXT_PUBLIC_VERCEL_ENV === "development";
export const IS_DEBUG = process.env.NEXT_PUBLIC_ENABLE_DEBUG === "true";
