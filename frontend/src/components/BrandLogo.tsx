import { cn } from '@/lib/utils';
import { withBasePath } from '@/lib/site';

type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  variant?: 'icon' | 'wordmark';
};

export function BrandLogo({ className, imageClassName, variant = 'icon' }: BrandLogoProps) {
  const src = variant === 'wordmark'
    ? withBasePath('/passbar-wordmark.svg')
    : withBasePath('/passbar-icon.svg');

  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      <img
        src={src}
        alt="PassBar"
        className={cn('block h-full w-full object-contain', imageClassName)}
        draggable={false}
      />
    </span>
  );
}
