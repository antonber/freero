// How each item type reads in the layers list: an icon and a short name.
import type { ComponentType } from 'react';
import { Frame, Image, ListTodo, MessageSquare, Network, PenLine, Shapes, Spline, Square, Stamp, StickyNote, Type } from 'lucide-react';

type Icon = ComponentType<{ size?: number | string; strokeWidth?: number | string }>;

const TYPES: Record<string, { icon: Icon; name: string }> = {
  sticky: { icon: StickyNote, name: 'Sticky note' },
  shape: { icon: Shapes, name: 'Shape' },
  text: { icon: Type, name: 'Text' },
  connector: { icon: Spline, name: 'Connector' },
  pen: { icon: PenLine, name: 'Drawing' },
  frame: { icon: Frame, name: 'Frame' },
  image: { icon: Image, name: 'Image' },
  card: { icon: ListTodo, name: 'Card' },
  emoji: { icon: Stamp, name: 'Stamp' },
  mindmap: { icon: Network, name: 'Mind map' },
  comment: { icon: MessageSquare, name: 'Comment' },
};

export const typeInfo = (type: string): { icon: Icon; name: string } =>
  TYPES[type] ?? { icon: Square, name: type.charAt(0).toUpperCase() + type.slice(1) };
