'use client'

import { cn } from '@/lib/cn'
import type { PageImage } from '@/lib/pdf-processor'

interface PageThumbnailsProps {
  pages: PageImage[]
  currentPage: number
  onPageSelect: (page: number) => void
}

export function PageThumbnails({ pages, currentPage, onPageSelect }: PageThumbnailsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto border-t bg-gray-100 p-2">
      {pages.map((page) => (
        <button
          key={page.pageNumber}
          onClick={() => onPageSelect(page.pageNumber)}
          className={cn(
            'relative flex-shrink-0 overflow-hidden rounded border-2 transition-all',
            currentPage === page.pageNumber
              ? 'border-blue-500 ring-2 ring-blue-200'
              : 'border-transparent hover:border-gray-300'
          )}
        >
          <img
            src={page.dataUrl}
            alt={`Page ${page.pageNumber}`}
            className="h-20 w-16 object-cover object-top"
          />
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 py-0.5 text-center text-xs',
              currentPage === page.pageNumber ? 'bg-blue-500 text-white' : 'bg-black/50 text-white'
            )}
          >
            {page.pageNumber}
          </div>
        </button>
      ))}
    </div>
  )
}
