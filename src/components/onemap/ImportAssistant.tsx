import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  suggestions?: string[];
}

interface ImportGuidance {
  question: string;
  answer: string;
  commands?: string[];
  nextSteps?: string[];
}

const IMPORT_GUIDANCE: Record<string, ImportGuidance> = {
  'file too large': {
    question: 'What if my file is too large for UI import?',
    answer: 'For large files (>10,000 records or >50MB), use the CLI method which is optimized for performance and can handle much larger datasets without browser limitations.',
    commands: ['node scripts/conservative-lawley-import.js'],
    nextSteps: ['Monitor progress with: node scripts/quick-verification.js', 'Generate report with: node scripts/generate-verification-report.js']
  },
  'slow import': {
    question: 'Why is the import running slowly?',
    answer: 'Large files require sequential processing to avoid database connection limits. This is normal and ensures data integrity. The conservative approach processes ~4-5 records/second.',
    nextSteps: ['Let it run in background', 'Check progress periodically', 'Expected completion: 15-30 minutes for large files']
  },
  'verification': {
    question: 'How do I verify the imported data?',
    answer: 'Use our comprehensive verification suite to check data quality, completeness, and integrity.',
    commands: [
      'node scripts/quick-verification.js',
      'node scripts/verify-lawley-import.js',
      'node scripts/generate-verification-report.js'
    ]
  },
  'errors': {
    question: 'What should I do if I see errors?',
    answer: 'Most errors are handled automatically. Check the verification report for details. Common issues include duplicate records or invalid GPS coordinates.',
    nextSteps: ['Run verification to identify issues', 'Review error logs', 'Contact support if needed']
  }
};

export const ImportAssistant: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'assistant',
      content: '👋 Hi! I\'m your OneMap import assistant. I can help you with:\n\n• File analysis and recommendations\n• Import troubleshooting\n• Data verification guidance\n• Progress monitoring\n\nWhat would you like to know?',
      timestamp: new Date(),
      suggestions: ['How do I import large files?', 'What if import is slow?', 'How to verify data?', 'Common error solutions']
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: content.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    // Simulate assistant thinking
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generate assistant response
    const response = generateResponse(content.toLowerCase());
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      type: 'assistant',
      content: response.content,
      timestamp: new Date(),
      suggestions: response.suggestions
    };

    setMessages(prev => [...prev, assistantMessage]);
    setIsTyping(false);
  };

  const generateResponse = (query: string): { content: string; suggestions?: string[] } => {
    // Check for specific guidance topics
    for (const [key, guidance] of Object.entries(IMPORT_GUIDANCE)) {
      if (query.includes(key)) {
        let content = guidance.answer;

        if (guidance.commands && guidance.commands.length > 0) {
          content += '\n\n💻 **Commands to run:**\n';
          guidance.commands.forEach(cmd => {
            content += `\`\`\`bash\n${cmd}\n\`\`\`\n`;
          });
        }

        if (guidance.nextSteps && guidance.nextSteps.length > 0) {
          content += '\n📋 **Next steps:**\n';
          guidance.nextSteps.forEach(step => {
            content += `• ${step}\n`;
          });
        }

        return { content, suggestions: ['Tell me more', 'Show me examples', 'What if I have issues?'] };
      }
    }

    // General responses
    if (query.includes('large') || query.includes('big') || query.includes('size')) {
      return {
        content: 'For large files (>10,000 records), I recommend using the CLI method:\n\n```bash\nnode scripts/conservative-lawley-import.js\n```\n\nThis method:\n• Handles files up to millions of records\n• Provides detailed progress monitoring\n• Includes automatic error recovery\n• Optimized for database performance\n\nThe UI method works best for smaller files (<5,000 records).',
        suggestions: ['How does CLI import work?', 'Monitor CLI progress', 'What about verification?']
      };
    }

    if (query.includes('progress') || query.includes('status')) {
      return {
        content: 'To check import progress:\n\n```bash\nnode scripts/quick-verification.js\n```\n\nThis will show:\n• Current records imported\n• Progress percentage\n• Data quality metrics\n• Estimated time remaining\n\nFor detailed analysis:\n```bash\nnode scripts/verify-lawley-import.js\n```',
        suggestions: ['What do the metrics mean?', 'How to interpret results?', 'What if progress is slow?']
      };
    }

    if (query.includes('verify') || query.includes('check') || query.includes('quality')) {
      return {
        content: 'Data verification is crucial! Here are your options:\n\n🔍 **Quick Check:**\n```bash\nnode scripts/quick-verification.js\n```\n\n📊 **Detailed Analysis:**\n```bash\nnode scripts/verify-lawley-import.js\n```\n\n📄 **Professional Report:**\n```bash\nnode scripts/generate-verification-report.js\n```\n\nThe verification checks:\n• Data completeness (missing fields)\n• Duplicate records\n• GPS coordinate validation\n• Import accuracy vs source file',
        suggestions: ['What does completeness mean?', 'How to fix duplicates?', 'Generate HTML report']
      };
    }

    if (query.includes('help') || query.includes('start') || query.includes('begin')) {
      return {
        content: 'Let\'s get you started with OneMap import!\n\n📋 **Step 1: Analyze your file**\n```bash\nnode scripts/smart-import-router.js\n```\n\n📊 **Step 2: Choose import method**\n• Small files (<5k records): Use UI import\n• Large files (>10k records): Use CLI import\n\n⚡ **Step 3: Import your data**\n```bash\nnode scripts/conservative-lawley-import.js\n```\n\n✅ **Step 4: Verify results**\n```bash\nnode scripts/quick-verification.js\n```\n\nNeed help with any specific step?',
        suggestions: ['Analyze my file', 'Start CLI import', 'Check progress', 'Verify data']
      };
    }

    // Default response
    return {
      content: 'I can help you with OneMap imports! Here are some things I can assist with:\n\n📁 **File Analysis**\n• Analyze file size and recommend import method\n• Check data structure and compatibility\n\n⚡ **Import Methods**\n• UI import for smaller files\n• CLI import for large datasets\n• Performance optimization guidance\n\n📊 **Progress Monitoring**\n• Real-time import status\n• Data quality metrics\n• Estimated completion time\n\n✅ **Data Verification**\n• Completeness checking\n• Duplicate detection\n• Quality validation\n• Report generation\n\nWhat specific aspect would you like help with?',
      suggestions: ['Analyze file', 'Start import', 'Check progress', 'Verify data', 'Troubleshoot issues']
    };
  };

  const handleSuggestionClick = (suggestion: string) => {
    handleSendMessage(suggestion);
  };

  return (
    <div className="max-w-4xl mx-auto bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4">
        <div className="flex items-center space-x-3">
          <Bot className="h-6 w-6" />
          <div>
            <h3 className="font-semibold">OneMap Import Assistant</h3>
            <p className="text-sm text-blue-100">Your AI guide for data imports</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="h-96 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
              message.type === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]'
            }`}>
              <div className="flex items-center space-x-2 mb-2">
                {message.type === 'user' ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
                <span className="text-xs opacity-75">
                  {message.timestamp.toLocaleTimeString()}
                </span>
              </div>
              
              <div className="whitespace-pre-wrap text-sm">
                {message.content}
              </div>

              {message.suggestions && message.suggestions.length > 0 && (
                <div className="mt-3 space-y-1">
                  {message.suggestions.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="block w-full text-left text-xs bg-card bg-opacity-20 hover:bg-opacity-30 rounded px-2 py-1 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-[var(--ff-bg-tertiary)] px-4 py-2 rounded-lg">
              <div className="flex items-center space-x-2">
                <Bot className="h-4 w-4" />
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-[var(--ff-text-tertiary)] rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-[var(--ff-text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-[var(--ff-text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--ff-border-light)] p-4">
        <div className="flex space-x-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage(inputValue)}
            placeholder="Ask me about OneMap imports..."
            className="flex-1 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
            disabled={isTyping}
          />
          <button
            onClick={() => handleSendMessage(inputValue)}
            disabled={!inputValue.trim() || isTyping}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => handleSendMessage('Analyze my file')}
            className="px-3 py-1 text-xs bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)] rounded-full transition-colors"
          >
            📊 Analyze File
          </button>
          <button
            onClick={() => handleSendMessage('Check progress')}
            className="px-3 py-1 text-xs bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)] rounded-full transition-colors"
          >
            📈 Check Progress
          </button>
          <button
            onClick={() => handleSendMessage('Verify data')}
            className="px-3 py-1 text-xs bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)] rounded-full transition-colors"
          >
            ✅ Verify Data
          </button>
          <button
            onClick={() => handleSendMessage('Help with errors')}
            className="px-3 py-1 text-xs bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)] rounded-full transition-colors"
          >
            🚨 Help with Errors
          </button>
        </div>
      </div>
    </div>
  );
};
