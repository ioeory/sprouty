import React from 'react';
import {
  Utensils,
  ShoppingBag,
  Car,
  ShoppingCart,
  Gamepad,
  Coins,
  Briefcase,
  Coffee,
  Home,
  Heart,
  BookOpen,
  Plane,
  Dumbbell,
  Gift,
  Phone,
  Tv,
  Wifi,
  Zap,
  CreditCard,
  PiggyBank,
  Baby,
  Stethoscope,
  GraduationCap,
  Film,
  Music,
  type LucideIcon,
} from 'lucide-react';

export const ICON_MAP: Record<string, LucideIcon> = {
  Utensils,
  ShoppingBag,
  Car,
  ShoppingCart,
  Gamepad,
  Coins,
  Briefcase,
  Coffee,
  Home,
  Heart,
  BookOpen,
  Plane,
  Dumbbell,
  Gift,
  Phone,
  Tv,
  Wifi,
  Zap,
  CreditCard,
  PiggyBank,
  Baby,
  Stethoscope,
  GraduationCap,
  Film,
  Music,
};

export const ICON_NAMES = Object.keys(ICON_MAP);

export const CATEGORY_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#71717a',
];

interface CategoryIconProps {
  name?: string;
  color?: string;
  size?: number;
  variant?: 'soft' | 'solid' | 'outline';
  className?: string;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({
  name,
  color = '#71717a',
  size = 36,
  variant = 'soft',
  className = '',
}) => {
  const Icon = (name && ICON_MAP[name]) || Coins;
  const iconSize = Math.round(size * 0.5);

  const bg =
    variant === 'solid'
      ? color
      : variant === 'outline'
      ? 'transparent'
      : `${color}18`;
  const fg = variant === 'solid' ? '#ffffff' : color;
  const border = variant === 'outline' ? `1px solid ${color}` : 'none';

  return (
    <span
      className={`inline-flex items-center justify-center rounded-[var(--radius-md)] shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: bg, color: fg, border }}
    >
      <Icon size={iconSize} strokeWidth={2} />
    </span>
  );
};
