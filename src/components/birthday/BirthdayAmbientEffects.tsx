"use client";

import { motion, useReducedMotion } from "framer-motion";

const FIREWORKS = [
  { x: 13, y: 30, delay: 0, color: "#f6d77a" },
  { x: 86, y: 34, delay: 1.7, color: "#c4a7ff" },
  { x: 74, y: 76, delay: 3.4, color: "#f3a6d2" },
  { x: 45, y: 18, delay: 5.1, color: "#a9c8ff" },
  { x: 28, y: 72, delay: 6.8, color: "#b6f5cd" },
] as const;

const COLORS = ["#f6d77a", "#e9c67c", "#fff0c4"] as const;

export default function BirthdayAmbientEffects() {
  const reduce = useReducedMotion();

  if (reduce) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="birthday-ambient-celebration"
      className="pointer-events-none fixed inset-0 z-[1] overflow-hidden"
    >
      {FIREWORKS.map((firework) => (
        <div
          key={`${firework.x}-${firework.y}`}
          className="absolute h-0 w-0"
          style={{ left: `${firework.x}%`, top: `${firework.y}%` }}
        >
          <motion.span
            className="absolute -left-1 -top-1 h-2 w-2 rounded-full"
            style={{
              backgroundColor: firework.color,
              boxShadow: `0 0 16px 5px ${firework.color}`,
            }}
            animate={{ scale: [0.2, 1.2, 0.1], opacity: [0, 0.8, 0] }}
            transition={{
              duration: 1.1,
              delay: firework.delay,
              repeat: Infinity,
              repeatDelay: 5.4,
              ease: "easeOut",
            }}
          />
          {Array.from({ length: 16 }, (_, index) => {
            const angle = (index / 16) * Math.PI * 2;
            const distance = 34 + ((index * 23) % 58);
            return (
              <motion.span
                key={index}
                className="absolute h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: firework.color,
                  boxShadow: `0 0 12px 3px ${firework.color}`,
                }}
                animate={{
                  x: [0, Math.cos(angle) * distance],
                  y: [0, Math.sin(angle) * distance],
                  opacity: [0, 0.8, 0],
                  scale: [0.2, 1, 0.1],
                }}
                transition={{
                  duration: 1.2,
                  delay: firework.delay,
                  repeat: Infinity,
                  repeatDelay: 5.8,
                  ease: "easeOut",
                }}
              />
            );
          })}
        </div>
      ))}
      {Array.from({ length: 28 }, (_, index) => (
        <motion.span
          key={`glitter-${index}`}
          className="absolute h-1 w-1 rounded-full"
          style={{
            left: `${(index * 41 + 7) % 100}%`,
            top: `${(index * 67 + 11) % 100}%`,
            backgroundColor: COLORS[index % COLORS.length],
            boxShadow: `0 0 10px 2px ${COLORS[index % COLORS.length]}`,
          }}
          animate={{ opacity: [0.12, 0.85, 0.18], scale: [0.5, 1.4, 0.6] }}
          transition={{
            duration: 2.2 + (index % 4) * 0.6,
            delay: (index % 8) * 0.35,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
      {Array.from({ length: 42 }, (_, index) => {
        const size = index % 7 === 0 ? 3 : index % 3 === 0 ? 2 : 1;
        const color = COLORS[index % COLORS.length];
        return (
          <motion.span
            key={`gold-glitter-${index}`}
            data-testid="birthday-gold-glitter"
            className="absolute rounded-full"
            style={{
              left: `${(index * 47 + 9) % 100}%`,
              top: `${(index * 67 + 11) % 100}%`,
              width: size,
              height: size,
              backgroundColor: color,
              boxShadow: `0 0 ${size * 5}px ${color}`,
            }}
            animate={{
              y: [0, index % 2 === 0 ? -18 : 18, 0],
              x: [0, index % 2 === 0 ? 5 : -5, 0],
              scale: [0.45, 1.5, 0.6],
              opacity: [0.12, 0.95, 0.2],
            }}
            transition={{
              duration: 2.4 + (index % 5) * 0.55,
              delay: (index % 9) * 0.3,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        );
      })}
    </div>
  );
}
