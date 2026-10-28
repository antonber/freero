import { ChartColumn, Cloud, ListOrdered, MessageCircleQuestion, Star } from 'lucide-react';
import type { ActivityKind } from '@freero/shared';

export const KIND_ICON: Record<ActivityKind, typeof ChartColumn> = {
  poll: ChartColumn,
  wordcloud: Cloud,
  ranking: ListOrdered,
  rating: Star,
  qna: MessageCircleQuestion,
};
