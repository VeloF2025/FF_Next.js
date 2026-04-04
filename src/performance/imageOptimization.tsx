/**
 * Image Optimization Utilities
 * Provides lazy loading, WebP support, and responsive image handling
 */

import { useState, useEffect, useRef } from 'react';
import { log } from '@/lib/logger';

export interface ImageLoadOptions {
  src: string;
  alt: string;
  placeholder?: string;
  webpSrc?: string;
  sizes?: string;
  srcSet?: string;
  loading?: 'lazy' | 'eager';
  quality?: number;
  className?: string;
  onLoad?: (() => void) | undefined;
  onError?: (() => void) | undefined;
}

/**
 * Hook for optimized image loading with lazy loading and WebP support
 */
export function useOptimizedImage({
  src,
  webpSrc,
  placeholder,
  onLoad,
  onError
}: Pick<ImageLoadOptions, 'src' | 'webpSrc' | 'placeholder' | 'onLoad' | 'onError'>) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(placeholder || '');
  const [supportsWebP, setSupportsWebP] = useState(false);

  // Check WebP support
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const supportsWebP = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    setSupportsWebP(supportsWebP);
  }, []);

  // Preload image
  useEffect(() => {
    const imageSrc = supportsWebP && webpSrc ? webpSrc : src;
    
    const img = new Image();
    img.onload = () => {
      setCurrentSrc(imageSrc);
      setIsLoaded(true);
      onLoad?.();
    };
    img.onerror = () => {
      setHasError(true);
      onError?.();
    };
    img.src = imageSrc;
  }, [src, webpSrc, supportsWebP, onLoad, onError]);

  return {
    src: currentSrc,
    isLoaded,
    hasError,
    supportsWebP
  };
}

/**
 * Hook for intersection observer-based lazy loading
 */
export function useIntersectionObserver(
  ref: React.RefObject<Element>,
  options: IntersectionObserverInit = {}
) {
  const [isVisible, setIsVisible] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          setHasBeenVisible(true);
        } else {
          setIsVisible(false);
        }
      },
      {
        threshold: 0.1,
        rootMargin: '50px',
        ...options
      }
    );

    observer.observe(ref.current);

    return () => {
      observer.disconnect();
    };
  }, [ref, options]);

  return { isVisible, hasBeenVisible };
}

/**
 * Generate optimized image URLs for different sizes
 */
export function generateImageSrcSet(
  baseSrc: string,
  sizes: number[] = [320, 640, 768, 1024, 1280, 1920]
): string {
  return sizes
    .map(size => {
      const optimizedSrc = baseSrc.replace(/\.(jpg|jpeg|png|webp)$/i, `_${size}w.$1`);
      return `${optimizedSrc} ${size}w`;
    })
    .join(', ');
}

/**
 * Generate sizes attribute for responsive images
 */
export function generateSizes(breakpoints: Array<{ maxWidth: string; size: string }>): string {
  return breakpoints
    .map(({ maxWidth, size }) => `(max-width: ${maxWidth}) ${size}`)
    .join(', ');
}

/**
 * Lazy Image Component with optimizations
 */
interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
  alt: string;
  placeholder?: string;
  webpSrc?: string;
  fallbackSrc?: string;
  quality?: number;
  onLoad?: () => void;
  onError?: () => void;
}

export function LazyImage({
  src,
  alt,
  placeholder = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2VlZSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5Mb2FkaW5nLi4uPC90ZXh0Pjwvc3ZnPg==',
  webpSrc,
  fallbackSrc,
  onLoad,
  onError,
  className,
  ...props
}: LazyImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const { hasBeenVisible } = useIntersectionObserver(imageRef);
  const imageConfig: Pick<ImageLoadOptions, 'src' | 'webpSrc' | 'placeholder' | 'onLoad' | 'onError'> = {
    src: hasBeenVisible ? src : '',
    placeholder,
    onLoad,
    onError,
    ...(hasBeenVisible && webpSrc && { webpSrc })
  };
  
  const { src: optimizedSrc, isLoaded, hasError } = useOptimizedImage(imageConfig);

  const finalSrc = hasError && fallbackSrc 
    ? fallbackSrc 
    : optimizedSrc || placeholder;

  return (
    <img
      ref={imageRef}
      src={finalSrc}
      alt={alt}
      className={`transition-opacity duration-300 ${
        isLoaded ? 'opacity-100' : 'opacity-60'
      } ${className || ''}`}
      loading="lazy"
      {...props}
    />
  );
}

/**
 * Image compression utilities
 */
export class ImageCompressor {
  /**
   * Compress image file to target size and quality
   */
  static async compressImage(
    file: File,
    options: {
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
      format?: 'jpeg' | 'webp' | 'png';
    } = {}
  ): Promise<Blob> {
    const {
      maxWidth = 1920,
      maxHeight = 1080,
      quality = 0.8,
      format = 'jpeg'
    } = options;

    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        const { width, height } = this.calculateDimensions(
          img.width,
          img.height,
          maxWidth,
          maxHeight
        );

        canvas.width = width;
        canvas.height = height;

        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          `image/${format}`,
          quality
        );
      };

      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Calculate optimal dimensions while maintaining aspect ratio
   */
  private static calculateDimensions(
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number
  ): { width: number; height: number } {
    const aspectRatio = originalWidth / originalHeight;

    let width = originalWidth;
    let height = originalHeight;

    if (width > maxWidth) {
      width = maxWidth;
      height = width / aspectRatio;
    }

    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspectRatio;
    }

    return { width: Math.round(width), height: Math.round(height) };
  }

  /**
   * Generate multiple sizes for responsive images
   */
  static async generateMultipleSizes(
    file: File,
    sizes: number[] = [320, 640, 768, 1024, 1280, 1920]
  ): Promise<{ [key: string]: Blob }> {
    const results: { [key: string]: Blob } = {};

    for (const size of sizes) {
      try {
        const compressed = await this.compressImage(file, {
          maxWidth: size,
          maxHeight: size,
          quality: 0.8,
          format: 'webp'
        });
        results[`${size}w`] = compressed;
      } catch (error) {
        log.warn(`Failed to generate ${size}w version:`, { data: error }, 'imageOptimization');
      }
    }

    return results;
  }
}

/**
 * Progressive Image Loading Component
 */
interface ProgressiveImageProps {
  lowQualitySrc: string;
  highQualitySrc: string;
  alt: string;
  className?: string;
}

export function ProgressiveImage({
  lowQualitySrc,
  highQualitySrc,
  alt,
  className
}: ProgressiveImageProps) {
  const [isHighQualityLoaded, setIsHighQualityLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const { hasBeenVisible } = useIntersectionObserver(imageRef);

  useEffect(() => {
    if (!hasBeenVisible) return;

    const img = new Image();
    img.onload = () => setIsHighQualityLoaded(true);
    img.src = highQualitySrc;
  }, [hasBeenVisible, highQualitySrc]);

  return (
    <div className={`relative overflow-hidden ${className || ''}`}>
      <img
        ref={imageRef}
        src={lowQualitySrc}
        alt={alt}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
          isHighQualityLoaded ? 'opacity-0' : 'opacity-100'
        } filter blur-sm`}
      />
      {hasBeenVisible && (
        <img
          src={highQualitySrc}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            isHighQualityLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
}