import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface CardCarouselProps {
  title: string | React.ReactNode;
  titleClassName?: string;
  items: React.ReactNode[];
  itemsPerPage?: number;
  className?: string;
  cardContentClassName?: string;
  emptyState?: React.ReactNode;
  footer?: React.ReactNode;
  style?: React.CSSProperties;
  autoPlayInterval?: number;
  selectedIndex?: number;
  onIndexChange?: (index: number) => void;
}

export function CardCarousel({
  title,
  titleClassName,
  items,
  itemsPerPage = 1,
  className,
  cardContentClassName,
  emptyState,
  footer,
  style,
  autoPlayInterval,
  selectedIndex,
  onIndexChange,
}: CardCarouselProps) {
  const [internalIndex, setInternalIndex] = React.useState(0);
  const index = selectedIndex !== undefined ? selectedIndex : internalIndex;

  const handleIndexChange = (newIndex: number) => {
    if (selectedIndex === undefined) {
      setInternalIndex(newIndex);
    }
    onIndexChange?.(newIndex);
  };

  // Group items into pages
  const pages = [];
  for (let i = 0; i < items.length; i += itemsPerPage) {
    pages.push(items.slice(i, i + itemsPerPage));
  }
  const totalPages = pages.length;

  React.useEffect(() => {
    if (!autoPlayInterval || totalPages <= 1 || selectedIndex !== undefined) return;
    const timer = setInterval(() => {
      setInternalIndex((i) => (i + 1) % totalPages);
    }, autoPlayInterval);
    return () => clearInterval(timer);
  }, [totalPages, autoPlayInterval, selectedIndex]);

  return (
    <Card className={cn("shadow-md transition-all duration-700 hover:shadow-lg", className)} style={style}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className={cn("text-base font-semibold", titleClassName)}>{title}</CardTitle>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleIndexChange(i)}
                  className={cn(
                    'rounded-full transition-all duration-300',
                    i === index ? 'w-4 h-1.5 bg-primary' : 'w-1.5 h-1.5 bg-slate-300 hover:bg-slate-400',
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className={cardContentClassName}>
        {items.length === 0 && emptyState ? (
          emptyState
        ) : items.length === 0 ? null : (
          <div className={cn("relative overflow-hidden", footer ? "mb-4" : "")}>
            <div
              className="flex transition-transform duration-500 ease-in-out"
              style={{ transform: `translateX(-${index * 100}%)` }}
            >
              {pages.map((pageItems, pi) => (
                <div key={pi} className="w-full shrink-0 space-y-2 flex flex-col items-stretch justify-start">
                  {pageItems}
                </div>
              ))}
            </div>
          </div>
        )}
        {footer}
      </CardContent>
    </Card>
  );
}
