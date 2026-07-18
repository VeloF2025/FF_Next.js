"""
Email Learning Engine - Continuous Improvement via Feedback Loop
"""
import json
from pathlib import Path
from typing import Dict, Any, List
from datetime import datetime

class EmailLearningEngine:
    def __init__(self, data_dir=None):
        self.data_dir = data_dir or Path('data/learning')
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.feedback_file = self.data_dir / 'approval_feedback.jsonl'
        self.stats = {'by_category': {}}
    
    def record_approval(self, email_id: str, category: str, confidence: float, decision: str):
        """Record approval decision for learning."""
        feedback = {
            'email_id': email_id,
            'category': category,
            'confidence': confidence,
            'decision': decision,
            'timestamp': datetime.now().isoformat()
        }
        
        with open(self.feedback_file, 'a') as f:
            f.write(json.dumps(feedback) + chr(10))
        
        if category not in self.stats['by_category']:
            self.stats['by_category'][category] = {'total': 0, 'approved': 0, 'rejected': 0}
        
        cat_stats = self.stats['by_category'][category]
        cat_stats['total'] += 1
        if decision == 'approved':
            cat_stats['approved'] += 1
        elif decision == 'rejected':
            cat_stats['rejected'] += 1
    
    def should_auto_approve(self, category: str, confidence: float) -> bool:
        """Determine if draft should be auto-approved (Phase 3: Hybrid mode)."""
        if category not in self.stats['by_category']:
            return False
        
        cat_stats = self.stats['by_category'][category]
        if cat_stats['total'] < 50:
            return False
        
        approval_rate = cat_stats['approved'] / cat_stats['total']
        return approval_rate > 0.9 and confidence > 0.9
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get learning statistics."""
        return self.stats

if __name__ == '__main__':
    engine = EmailLearningEngine()
    print('Email Learning Engine initialized')
