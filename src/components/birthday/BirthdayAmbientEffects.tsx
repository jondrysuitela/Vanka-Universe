"use client";

import { motion, useReducedMotion } from "framer-motion";

const FIREWORKS = [
  { x: 13, y: 30, delay: 0, color: "#f6d77a" },
  { x: 86, y: 34, delay: 2.1, color: "#c4a7ff" },
  { x: 74, y: 76, delay: 4.2, color: "#f3a6d2" },
] as const;

const COLORS = ["#f6d77a", "#f3a6d2", "#a9c8ff", "#b6f5cd"] as const;

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
          {Array.from({ length: 12 }, (_, index) => {
            const angle = (index / 12) * Math.PI * 2;
            const distance = 26 + ((index * 13) % 28);
            return (
              <motion.span
                key={index}
                className="absolute h-1 w-1 rounded-full"
                style={{
                  backgroundColor: firework.color,
                  boxShadow: `0 0 8px 2px ${firework.color}`,
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
                  repeatDelay: 5.3,
                  ease: "easeOut",
                }}
              />
            );
          })}
        </div>
      ))}
      {Array.from({ length: 24 }, (_, index) => (
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
      {Array.from({ length: 18 }, (_, index) => (
        <motion.span
          key={`confetti-${index}`}
          className="absolute top-0 h-2 w-1 rounded-sm"
          style={{
            left: `${(index * 47 + 9) % 100}%`,
            backgroundColor: COLORS[index % COLORS.length],
          }}
          animate={{
            y: ["-5vh", "105vh"],
            x: [0, index % 2 === 0 ? 18 : -18, 0],
            rotate: [0, 180, 360],
            opacity: [0, 0.55, 0.45, 0],
          }}
          transition={{
            duration: 8 + (index % 5),
            delay: (index % 9) * 0.8,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}
    </div>
  );
}
