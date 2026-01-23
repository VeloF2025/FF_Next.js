/**
 * QuoteDisplay - Displays a motivational quote with fade-in animation
 * Features: italic styling, author attribution, responsive sizing
 */

import { useEffect, useState } from 'react';
import { MotivationalQuote } from '@/data/motivational-quotes';

interface QuoteDisplayProps {
  quote: MotivationalQuote;
}

export function QuoteDisplay({ quote }: QuoteDisplayProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger fade-in animation after mount
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`transition-all duration-1000 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      {/* Quote icon */}
      <div className="mb-4 lg:mb-6">
        <svg
          className="w-8 h-8 lg:w-12 lg:h-12 text-emerald-500/40"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
        </svg>
      </div>

      {/* Quote text */}
      <blockquote className="relative">
        <p className="text-xl lg:text-2xl xl:text-3xl font-light italic text-slate-200 leading-relaxed mb-6 lg:mb-8">
          {quote.text}
        </p>
      </blockquote>

      {/* Author attribution */}
      <div className="flex items-center space-x-3">
        <div className="w-12 h-0.5 bg-gradient-to-r from-emerald-500 to-transparent" />
        <div>
          <p className="text-base lg:text-lg font-medium text-slate-100">
            {quote.author}
          </p>
          {quote.role && (
            <p className="text-sm text-slate-400">
              {quote.role}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
