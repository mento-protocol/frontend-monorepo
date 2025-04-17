"use client";

import Image from "next/image";
import { useState } from "react";

interface OptimizedImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  className = "",
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div className="relative overflow-hidden">
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={`transition-all duration-300 ${isLoading ? "scale-110 blur-sm" : "scale-100 blur-0"} ${className} `}
        onLoad={() => setIsLoading(false)}
        priority={false}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200/50">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-transparent" />
        </div>
      )}
    </div>
  );
}
