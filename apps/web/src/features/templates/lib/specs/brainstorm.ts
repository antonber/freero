// Brainstorm templates (specs: see ../spec/types.ts; after editing run `npm run templates:index`).
import type { TemplateSpec } from '../spec/types';

const specs: TemplateSpec[] = [
  {
    id: 'scamper',
    name: 'SCAMPER prompts',
    description: 'Seven ways to twist an existing product or process into new ideas: swap, combine, adapt, resize, repurpose, remove, reverse.',
    categories: ['brainstorm', 'product'],
    keywords: ['scamper', 'ideation', 'creative thinking', 'idea generation', 'innovation', 'product ideas', 'lateral thinking'],
    hint: 'Pick one thing to improve and write it at the top. Spend three minutes per row; quantity first, judge later.',
    archetype: 'prompts',
    items: [
      { prompt: 'Substitute: what could we swap out?', detail: 'A material, a step, a person, a channel.', tone: 'violet', notes: ['Reusable glass jars instead of plastic tubs', 'Courier bikes instead of vans downtown'] },
      { prompt: 'Combine: what could work together?', detail: 'Merge two products, services or steps into one.', tone: 'sky', notes: ['Meal kit + cooking class in one box', 'Recipe card doubles as a shopping list'] },
      { prompt: 'Adapt: what works elsewhere that we could borrow?', detail: 'Look at other industries and nature.', tone: 'mint', notes: ['Subscription pause like streaming services', 'Wine-style tasting notes for spices'] },
      { prompt: 'Resize: what if it were bigger, smaller or more often?', detail: 'Change the scale, frequency or strength.', tone: 'amber', notes: ['Single-portion kit for people living alone', 'Family box for 6 on Sundays'] },
      { prompt: 'Repurpose: who else could use it, or for what?', detail: 'New users, new occasions, new markets.', tone: 'rose', notes: ['Office lunch kits for small teams', 'Camping edition that needs no fridge'] },
      { prompt: 'Remove: what could we leave out?', detail: 'Simplify until it hurts, then add one thing back.', tone: 'coral', notes: ['No printed recipe: QR code only', 'Drop the 4-step chilli, keep the 3-step one'] },
      { prompt: 'Reverse: what if we did it the other way round?', detail: 'Flip the order, the roles or the assumption.', tone: 'gray', notes: ['Customers send us their family recipe to kit', 'Cook first, choose the recipe name after'] },
    ],
  },
];

export default specs;
