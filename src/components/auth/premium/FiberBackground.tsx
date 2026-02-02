/**
 * FiberBackground - Premium animated background for login page
 * Features: gradient base, animated fiber lines, floating particles, vignette
 */

import { useEffect, useState } from 'react';

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
}

export function FiberBackground() {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    // Generate random particles on mount
    const newParticles: Particle[] = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      duration: Math.random() * 15 + 10,
      delay: Math.random() * 5,
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Base gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, #0a0f1a 0%, #0f172a 50%, #0a1628 100%)',
        }}
      />

      {/* Fiber optic lines - SVG pattern */}
      <svg
        className="absolute inset-0 w-full h-full opacity-20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="fiberGradient1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0" />
            <stop offset="50%" stopColor="#10b981" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="fiberGradient2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#059669" stopOpacity="0" />
            <stop offset="50%" stopColor="#059669" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#059669" stopOpacity="0" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Animated fiber lines */}
        <g filter="url(#glow)">
          {/* Diagonal fibers */}
          <line
            x1="0" y1="20%" x2="100%" y2="80%"
            stroke="url(#fiberGradient1)"
            strokeWidth="1"
            className="animate-fiber-pulse"
          />
          <line
            x1="10%" y1="0" x2="90%" y2="100%"
            stroke="url(#fiberGradient2)"
            strokeWidth="0.5"
            className="animate-fiber-pulse-delayed"
          />
          <line
            x1="0" y1="60%" x2="100%" y2="30%"
            stroke="url(#fiberGradient1)"
            strokeWidth="0.8"
            className="animate-fiber-pulse-slow"
          />
          <line
            x1="20%" y1="100%" x2="80%" y2="0"
            stroke="url(#fiberGradient2)"
            strokeWidth="0.6"
            className="animate-fiber-pulse"
          />
          <line
            x1="0" y1="40%" x2="100%" y2="70%"
            stroke="url(#fiberGradient1)"
            strokeWidth="0.4"
            className="animate-fiber-pulse-delayed"
          />

          {/* Curved fiber paths */}
          <path
            d="M 0 50 Q 25 30 50 50 T 100 50"
            fill="none"
            stroke="url(#fiberGradient1)"
            strokeWidth="0.8"
            className="animate-fiber-pulse-slow"
            style={{ transform: 'translateY(20%)' }}
          />
          <path
            d="M 0 50 Q 25 70 50 50 T 100 50"
            fill="none"
            stroke="url(#fiberGradient2)"
            strokeWidth="0.5"
            className="animate-fiber-pulse"
            style={{ transform: 'translateY(60%)' }}
          />
        </g>
      </svg>

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(16, 185, 129, 0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16, 185, 129, 0.3) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* Floating particles */}
      <div className="absolute inset-0">
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute rounded-full animate-drift"
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              background: 'radial-gradient(circle, rgba(16, 185, 129, 0.8) 0%, rgba(16, 185, 129, 0) 70%)',
              boxShadow: '0 0 10px rgba(16, 185, 129, 0.5)',
              animationDuration: `${particle.duration}s`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Radial vignette overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 0%, rgba(10, 15, 26, 0.4) 70%, rgba(10, 15, 26, 0.8) 100%)',
        }}
      />

      {/* Top-left accent glow */}
      <div
        className="absolute -top-40 -left-40 w-96 h-96 opacity-20"
        style={{
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.4) 0%, transparent 70%)',
        }}
      />

      {/* Bottom-right accent glow */}
      <div
        className="absolute -bottom-40 -right-40 w-96 h-96 opacity-15"
        style={{
          background: 'radial-gradient(circle, rgba(5, 150, 105, 0.4) 0%, transparent 70%)',
        }}
      />

      {/* Inline styles for animations */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style jsx>{`
        @keyframes fiber-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.8; }
        }

        @keyframes drift {
          0% {
            transform: translate(0, 0) scale(1);
            opacity: 0.6;
          }
          25% {
            transform: translate(20px, -30px) scale(1.1);
            opacity: 0.8;
          }
          50% {
            transform: translate(-10px, -50px) scale(0.9);
            opacity: 0.5;
          }
          75% {
            transform: translate(-30px, -20px) scale(1.05);
            opacity: 0.7;
          }
          100% {
            transform: translate(0, 0) scale(1);
            opacity: 0.6;
          }
        }

        .animate-fiber-pulse {
          animation: fiber-pulse 4s ease-in-out infinite;
        }

        .animate-fiber-pulse-delayed {
          animation: fiber-pulse 4s ease-in-out infinite;
          animation-delay: 1s;
        }

        .animate-fiber-pulse-slow {
          animation: fiber-pulse 6s ease-in-out infinite;
        }

        .animate-drift {
          animation: drift 15s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
