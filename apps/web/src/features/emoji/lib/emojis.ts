// Curated emoji set for the picker. Each entry: "<emoji> <search words…>".
export interface EmojiEntry {
  emoji: string;
  words: string;
}

export interface EmojiCategory {
  id: string;
  label: string;
  /** Emoji shown on the category tab. */
  icon: string;
  items: EmojiEntry[];
}

const parse = (lines: string): EmojiEntry[] =>
  lines
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(' ');
      return { emoji: l.slice(0, i), words: l.slice(i + 1).toLowerCase() };
    });

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    items: parse(`
      😀 grin happy smile
      😃 smile happy joy
      😄 laugh happy smile
      😁 beaming grin teeth
      😆 laughing squint
      😅 sweat relief nervous
      🤣 rofl rolling laughing
      😂 tears joy laughing lol
      🙂 slight smile
      😉 wink
      😊 blush happy
      😇 angel innocent halo
      🥰 love hearts adore
      😍 heart eyes love
      🤩 star struck wow excited
      😘 kiss
      😋 yum tasty delicious
      😎 cool sunglasses
      🤓 nerd geek glasses
      🧐 monocle curious inspect
      🤔 thinking hmm wonder
      🤨 raised eyebrow skeptical
      😐 neutral meh
      😑 expressionless
      😶 no mouth silent
      🙄 eye roll
      😏 smirk
      😬 grimace awkward
      😌 relieved calm
      😴 sleeping tired zzz
      🤤 drool
      😷 mask sick
      🤯 mind blown exploding
      🥳 party celebrate
      🥺 pleading puppy eyes
      😢 cry sad tear
      😭 sob crying
      😱 scream shocked
      😤 triumph huff
      😡 angry mad rage
      🤬 swearing cursing
      😈 devil mischief
      💀 skull dead
      👻 ghost boo
      🤖 robot bot
      👽 alien
      💩 poop
      🫠 melting
      🫡 salute
      🤗 hug hugging
      🤭 oops giggle
      🤫 shush quiet secret
    `),
  },
  {
    id: 'people',
    label: 'Gestures',
    icon: '👍',
    items: parse(`
      👍 thumbs up yes like approve +1
      👎 thumbs down no dislike -1
      👏 clap applause bravo
      🙌 raise hands celebrate hooray
      👐 open hands
      🤝 handshake deal agree
      🙏 pray please thanks
      👋 wave hello hi bye
      ✌️ peace victory
      🤞 fingers crossed luck hope
      🤟 love you
      🤘 rock on
      👌 ok perfect
      🤌 pinched chef
      👈 point left
      👉 point right
      👆 point up
      👇 point down
      ☝️ index up one
      ✋ raised hand stop
      🖐️ hand five
      ✊ fist
      👊 fist bump punch
      💪 muscle strong flex
      🫶 heart hands love
      👀 eyes look see
      🧠 brain think smart
      🗣️ speaking talk
      🙋 raising hand question
      🙅 no gesture
      🙆 ok gesture
      🤷 shrug dunno
      🤦 facepalm
      🧑‍💻 developer coder laptop
      🧑‍🎨 artist designer
      🧑‍🏫 teacher
      🧑‍🚀 astronaut
      🕵️ detective investigate
      🦸 superhero hero
      🏃 run running fast
    `),
  },
  {
    id: 'nature',
    label: 'Nature',
    icon: '🌿',
    items: parse(`
      🐶 dog puppy
      🐱 cat kitten
      🦊 fox
      🐻 bear
      🐼 panda
      🐨 koala
      🦁 lion
      🐯 tiger
      🐸 frog
      🐵 monkey
      🦄 unicorn magic
      🐝 bee busy
      🦋 butterfly
      🐢 turtle slow
      🐙 octopus
      🐳 whale
      🦉 owl wise
      🐧 penguin
      🐞 ladybug bug
      🌵 cactus
      🌲 tree evergreen
      🌳 tree
      🌱 seedling grow sprout
      🌿 herb leaf
      🍀 clover luck
      🍁 maple leaf autumn
      🌸 blossom flower spring
      🌻 sunflower
      🌹 rose
      🌈 rainbow
      ☀️ sun sunny
      🌙 moon night
      ⭐ star
      🌟 glowing star shine
      ⚡ lightning zap energy
      🔥 fire hot lit
      💧 droplet water
      ❄️ snowflake cold
      🌊 wave ocean
      🌍 earth globe world
    `),
  },
  {
    id: 'food',
    label: 'Food',
    icon: '🍕',
    items: parse(`
      🍎 apple
      🍌 banana
      🍓 strawberry
      🍉 watermelon
      🍋 lemon
      🍑 peach
      🥑 avocado
      🥕 carrot
      🌽 corn
      🍞 bread
      🥐 croissant
      🧀 cheese
      🍔 burger
      🍟 fries
      🍕 pizza
      🌮 taco
      🍣 sushi
      🍜 noodles ramen
      🍩 donut
      🍪 cookie
      🎂 cake birthday
      🧁 cupcake
      🍫 chocolate
      🍿 popcorn
      ☕ coffee tea
      🍵 tea
      🧋 bubble tea
      🍺 beer
      🍷 wine
      🥂 cheers toast
      🍾 champagne celebrate
      🧃 juice
    `),
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: '🎉',
    items: parse(`
      🎉 party tada celebrate
      🎊 confetti
      🎈 balloon
      🎁 gift present
      🏆 trophy win winner
      🥇 gold medal first
      🥈 silver medal second
      🥉 bronze medal third
      🏅 medal
      🎯 target goal bullseye
      🎮 game controller
      🎲 dice chance
      🧩 puzzle piece
      🎨 art palette design
      🎬 clapper film
      🎤 microphone sing
      🎧 headphones music
      🎵 music note
      ⚽ soccer football
      🏀 basketball
      🎾 tennis
      🏓 ping pong
      🚴 cycling bike
      🧘 yoga calm meditate
      🏔️ mountain
      🏖️ beach vacation
      🎪 circus tent
      🪄 magic wand
    `),
  },
  {
    id: 'travel',
    label: 'Travel',
    icon: '🚀',
    items: parse(`
      🚀 rocket launch ship
      ✈️ airplane flight travel
      🚗 car
      🚕 taxi
      🚌 bus
      🚲 bicycle
      🚂 train
      🚢 ship boat
      ⛵ sailboat
      🛸 ufo
      🚧 construction wip
      🚦 traffic light
      🗺️ map
      🧭 compass direction
      🏠 house home
      🏢 office building
      🏭 factory
      🏰 castle
      🗽 statue liberty
      🗻 mount fuji
      🌋 volcano
      🏝️ island
      ⛺ camping tent
      🌉 bridge
      🌆 city dusk
      🌃 night city
    `),
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '💡',
    items: parse(`
      💡 idea bulb light
      📌 pin pushpin
      📍 location pin
      📎 paperclip attach
      ✏️ pencil edit
      🖊️ pen write
      📝 memo note
      📋 clipboard
      📅 calendar date
      📆 calendar
      🗓️ schedule
      📈 chart up growth
      📉 chart down decline
      📊 bar chart stats
      💻 laptop computer
      🖥️ desktop
      📱 phone mobile
      ⌨️ keyboard
      🖱️ mouse
      🔍 search magnifier
      🔑 key
      🔒 lock locked
      🔓 unlocked open
      🔔 bell notification
      📣 megaphone announce
      📢 loudspeaker
      📦 package box ship
      📚 books read
      📖 book open
      🗂️ dividers folders
      📁 folder
      🧪 test tube experiment
      🔬 microscope research
      🧲 magnet
      🛠️ tools build
      🔧 wrench fix
      ⚙️ gear settings
      🧰 toolbox
      ⏰ alarm clock
      ⏳ hourglass waiting time
      💰 money bag
      💎 gem diamond
      🪙 coin
      🧯 extinguisher fire
    `),
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '❤️',
    items: parse(`
      ❤️ red heart love
      🧡 orange heart
      💛 yellow heart
      💚 green heart
      💙 blue heart
      💜 purple heart
      🖤 black heart
      🤍 white heart
      💔 broken heart
      💖 sparkling heart
      ✨ sparkles magic new
      💯 hundred perfect
      ✅ check done yes
      ☑️ checkbox
      ✔️ check mark
      ❌ cross no wrong
      ❎ cross mark
      ⭕ circle
      ❗ exclamation important
      ❓ question
      ⚠️ warning caution
      🚫 prohibited forbidden
      ⛔ no entry stop
      🔴 red circle
      🟠 orange circle
      🟡 yellow circle
      🟢 green circle
      🔵 blue circle
      🟣 purple circle
      ⚫ black circle
      ➕ plus add
      ➖ minus
      ➡️ right arrow
      ⬅️ left arrow
      ⬆️ up arrow
      ⬇️ down arrow
      🔁 repeat loop
      🔄 refresh sync
      🆕 new
      🆗 ok
      🆒 cool
      🏁 finish flag
      🚩 red flag
      💤 sleep zzz
      💬 speech chat comment
      💭 thought bubble
    `),
  },
];

/** Case-insensitive search over the keywords of every category. */
export function searchEmojis(query: string, limit = 64): EmojiEntry[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: EmojiEntry[] = [];
  const seen = new Set<string>();
  for (const cat of EMOJI_CATEGORIES)
    for (const it of cat.items) {
      if (seen.has(it.emoji)) continue;
      const words = it.words.split(' ');
      if (terms.every((t) => words.some((w) => w.startsWith(t)))) {
        out.push(it);
        seen.add(it.emoji);
        if (out.length >= limit) return out;
      }
    }
  return out;
}
