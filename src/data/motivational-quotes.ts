/**
 * Curated motivational business quotes from real figures
 * Used on the premium login page
 */

export interface MotivationalQuote {
  id: number;
  text: string;
  author: string;
  role?: string;
}

export const MOTIVATIONAL_QUOTES: MotivationalQuote[] = [
  {
    id: 1,
    text: "Innovation distinguishes between a leader and a follower.",
    author: "Steve Jobs",
    role: "Co-founder, Apple"
  },
  {
    id: 2,
    text: "When something is important enough, you do it even if the odds are not in your favor.",
    author: "Elon Musk",
    role: "CEO, Tesla & SpaceX"
  },
  {
    id: 3,
    text: "Your most unhappy customers are your greatest source of learning.",
    author: "Bill Gates",
    role: "Co-founder, Microsoft"
  },
  {
    id: 4,
    text: "I knew that if I failed I wouldn't regret that, but I knew the one thing I might regret is not trying.",
    author: "Jeff Bezos",
    role: "Founder, Amazon"
  },
  {
    id: 5,
    text: "Price is what you pay. Value is what you get.",
    author: "Warren Buffett",
    role: "CEO, Berkshire Hathaway"
  },
  {
    id: 6,
    text: "The way to get started is to quit talking and begin doing.",
    author: "Walt Disney",
    role: "Founder, The Walt Disney Company"
  },
  {
    id: 7,
    text: "Stay hungry, stay foolish.",
    author: "Steve Jobs",
    role: "Co-founder, Apple"
  },
  {
    id: 8,
    text: "Chase the vision, not the money; the money will end up following you.",
    author: "Tony Hsieh",
    role: "Former CEO, Zappos"
  },
  {
    id: 9,
    text: "Success is not final, failure is not fatal: it is the courage to continue that counts.",
    author: "Winston Churchill",
    role: "Former Prime Minister, UK"
  },
  {
    id: 10,
    text: "The only way to do great work is to love what you do.",
    author: "Steve Jobs",
    role: "Co-founder, Apple"
  },
  {
    id: 11,
    text: "It's fine to celebrate success, but it is more important to heed the lessons of failure.",
    author: "Bill Gates",
    role: "Co-founder, Microsoft"
  },
  {
    id: 12,
    text: "Risk more than others think is safe. Dream more than others think is practical.",
    author: "Howard Schultz",
    role: "Former CEO, Starbucks"
  },
  {
    id: 13,
    text: "The best time to plant a tree was 20 years ago. The second best time is now.",
    author: "Chinese Proverb",
  },
  {
    id: 14,
    text: "Don't be afraid to give up the good to go for the great.",
    author: "John D. Rockefeller",
    role: "Founder, Standard Oil"
  },
  {
    id: 15,
    text: "In the middle of difficulty lies opportunity.",
    author: "Albert Einstein",
    role: "Theoretical Physicist"
  },
  {
    id: 16,
    text: "The secret of getting ahead is getting started.",
    author: "Mark Twain",
    role: "Author"
  },
  {
    id: 17,
    text: "A person who never made a mistake never tried anything new.",
    author: "Albert Einstein",
    role: "Theoretical Physicist"
  },
  {
    id: 18,
    text: "Whether you think you can, or you think you can't – you're right.",
    author: "Henry Ford",
    role: "Founder, Ford Motor Company"
  },
  {
    id: 19,
    text: "The only limit to our realization of tomorrow is our doubts of today.",
    author: "Franklin D. Roosevelt",
    role: "32nd US President"
  },
  {
    id: 20,
    text: "Move fast and break things. Unless you are breaking stuff, you are not moving fast enough.",
    author: "Mark Zuckerberg",
    role: "CEO, Meta"
  },
  {
    id: 21,
    text: "Coming together is a beginning. Keeping together is progress. Working together is success.",
    author: "Henry Ford",
    role: "Founder, Ford Motor Company"
  },
  {
    id: 22,
    text: "The greatest glory in living lies not in never falling, but in rising every time we fall.",
    author: "Nelson Mandela",
    role: "Former President, South Africa"
  },
  {
    id: 23,
    text: "If you really look closely, most overnight successes took a long time.",
    author: "Steve Jobs",
    role: "Co-founder, Apple"
  },
  {
    id: 24,
    text: "Quality is not an act, it is a habit.",
    author: "Aristotle",
    role: "Greek Philosopher"
  },
  {
    id: 25,
    text: "Do not be embarrassed by your failures, learn from them and start again.",
    author: "Richard Branson",
    role: "Founder, Virgin Group"
  },
  {
    id: 26,
    text: "The best way to predict the future is to create it.",
    author: "Peter Drucker",
    role: "Management Consultant"
  },
  {
    id: 27,
    text: "Opportunities don't happen. You create them.",
    author: "Chris Grosser",
    role: "Entrepreneur"
  },
  {
    id: 28,
    text: "If you are not willing to risk the usual, you will have to settle for the ordinary.",
    author: "Jim Rohn",
    role: "Motivational Speaker"
  },
  {
    id: 29,
    text: "Build your own dreams, or someone else will hire you to build theirs.",
    author: "Farrah Gray",
    role: "Entrepreneur & Author"
  },
  {
    id: 30,
    text: "Great things in business are never done by one person. They're done by a team of people.",
    author: "Steve Jobs",
    role: "Co-founder, Apple"
  }
];

/**
 * Get a random quote from the collection
 * Uses a simple random selection for variety on each page load
 */
export function getRandomQuote(): MotivationalQuote {
  const index = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length);
  return MOTIVATIONAL_QUOTES[index]!;
}

/**
 * Get a specific quote by ID (useful for testing)
 */
export function getQuoteById(id: number): MotivationalQuote | undefined {
  return MOTIVATIONAL_QUOTES.find(q => q.id === id);
}
