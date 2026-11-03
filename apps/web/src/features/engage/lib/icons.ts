import { ChartColumn, Cloud, Grid2x2, ListOrdered, MessageCircleQuestion, Star, Trophy } from 'lucide-react';
import type { ActivityKind } from '@freero/shared';

export const KIND_ICON: Record<ActivityKind, typeof ChartColumn> = {
  poll: ChartColumn,
  wordcloud: Cloud,
  ranking: ListOrdered,
  rating: Star,
  qna: MessageCircleQuestion,
  matrix: Grid2x2,
  quiz: Trophy,
};
