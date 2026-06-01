import {
  Home,
  MessageSquare,
  Lightbulb,
  BookOpen,
  Gamepad2,
  Hash,
  type LucideIcon,
} from 'lucide-react';

const ROOM_ICON_MAP: Record<string, LucideIcon> = {
  general: Home,
  confessions: MessageSquare,
  advice: Lightbulb,
  academic: BookOpen,
  memes: Gamepad2,
};

export function getRoomIcon(roomId: string): LucideIcon {
  return ROOM_ICON_MAP[roomId] || Hash;
}

interface RoomIconProps {
  roomId: string;
  className?: string;
  active?: boolean;
}

export function RoomIcon({ roomId, className, active }: RoomIconProps) {
  const Icon = getRoomIcon(roomId);
  return (
    <Icon
      className={className}
      size={18}
      strokeWidth={1.75}
      color={active ? '#fff' : '#888'}
    />
  );
}
