/**
 * Basic tests for the Matching Engine
 */

import { MatchingEngine } from '../matchingEngine';
import { MatchingTransaction, MatchingReceipt } from '../types';

describe('MatchingEngine', () => {
  let engine: MatchingEngine;

  beforeEach(() => {
    engine = new MatchingEngine();
  });

  describe('constructor', () => {
    it('should create engine with default config', () => {
      const config = engine.getConfig();
      expect(config.amount_tolerance_percentage).toBe(0.05);
      expect(config.auto_match_threshold).toBe(0.85);
      expect(config.suggest_threshold).toBe(0.5);
    });

    it('should accept custom config', () => {
      const customEngine = new MatchingEngine({
        amount_tolerance_percentage: 0.1,
        auto_match_threshold: 0.9
      });
      
      const config = customEngine.getConfig();
      expect(config.amount_tolerance_percentage).toBe(0.1);
      expect(config.auto_match_threshold).toBe(0.9);
      expect(config.suggest_threshold).toBe(0.5); // Should keep default
    });
  });

  describe('findMatchCandidates', () => {
    it('should find exact matches', async () => {
      const transaction: MatchingTransaction = {
        id: 'txn_1',
        organization_id: 'org_1',
        amount: 25.99,
        transaction_date: new Date('2024-01-15'),
        posted_date: new Date('2024-01-15'),
        description: 'STARBUCKS #1234',
        merchant_name: 'Starbucks',
        user_id: 'user_1',
        account_id: 'acc_1',
        currency: 'USD',
        status: 'posted'
      };

      const receipts: MatchingReceipt[] = [
        {
          id: 'rcpt_1',
          organization_id: 'org_1',
          total_amount: 25.99,
          currency: 'USD',
          receipt_date: new Date('2024-01-15'),
          merchant_name: 'Starbucks',
          uploaded_by: 'user_1',
          status: 'processed',
          metadata: {},
          extracted_fields: []
        }
      ];

      const candidates = await engine.findMatchCandidates(transaction, receipts);
      
      expect(candidates).toHaveLength(1);
      expect(candidates[0].confidence_score).toBeGreaterThan(0.8);
      expect(candidates[0].match_criteria.amount_match.matched).toBe(true);
      expect(candidates[0].match_criteria.date_match.matched).toBe(true);
      expect(candidates[0].match_criteria.user_match.matched).toBe(true);
    });

    it('should handle amount tolerance', async () => {
      const transaction: MatchingTransaction = {
        id: 'txn_1',
        organization_id: 'org_1',
        amount: 25.99,
        transaction_date: new Date('2024-01-15'),
        posted_date: new Date('2024-01-15'),
        description: 'RESTAURANT',
        user_id: 'user_1',
        account_id: 'acc_1',
        currency: 'USD',
        status: 'posted'
      };

      const receipts: MatchingReceipt[] = [
        {
          id: 'rcpt_1',
          organization_id: 'org_1',
          total_amount: 25.00, // $0.99 difference
          currency: 'USD',
          receipt_date: new Date('2024-01-15'),
          uploaded_by: 'user_1',
          status: 'processed',
          metadata: {},
          extracted_fields: []
        }
      ];

      const candidates = await engine.findMatchCandidates(transaction, receipts);
      
      expect(candidates).toHaveLength(1);
      expect(candidates[0].match_criteria.amount_match.matched).toBe(true); // Should match within tolerance
      expect(candidates[0].match_criteria.amount_match.difference).toBe(0.99);
    });

    it('should handle date window', async () => {
      const transaction: MatchingTransaction = {
        id: 'txn_1',
        organization_id: 'org_1',
        amount: 25.99,
        transaction_date: new Date('2024-01-15'),
        posted_date: new Date('2024-01-17'), // Posted 2 days later
        description: 'RESTAURANT',
        user_id: 'user_1',
        account_id: 'acc_1',
        currency: 'USD',
        status: 'posted'
      };

      const receipts: MatchingReceipt[] = [
        {
          id: 'rcpt_1',
          organization_id: 'org_1',
          total_amount: 25.99,
          currency: 'USD',
          receipt_date: new Date('2024-01-15'), // Same as transaction date
          uploaded_by: 'user_1',
          status: 'processed',
          metadata: {},
          extracted_fields: []
        }
      ];

      const candidates = await engine.findMatchCandidates(transaction, receipts);
      
      expect(candidates).toHaveLength(1);
      expect(candidates[0].match_criteria.date_match.matched).toBe(true);
      expect(candidates[0].match_criteria.date_match.days_difference).toBe(0);
    });

    it('should reject matches outside tolerances', async () => {
      const transaction: MatchingTransaction = {
        id: 'txn_1',
        organization_id: 'org_1',
        amount: 25.99,
        transaction_date: new Date('2024-01-15'),
        posted_date: new Date('2024-01-15'),
        description: 'RESTAURANT',
        user_id: 'user_1',
        account_id: 'acc_1',
        currency: 'USD',
        status: 'posted'
      };

      const receipts: MatchingReceipt[] = [
        {
          id: 'rcpt_1',
          organization_id: 'org_1',
          total_amount: 50.00, // Too different
          currency: 'USD',
          receipt_date: new Date('2024-01-25'), // Too far in future
          uploaded_by: 'user_2', // Different user
          status: 'processed',
          metadata: {},
          extracted_fields: []
        }
      ];

      const candidates = await engine.findMatchCandidates(transaction, receipts);
      
      expect(candidates).toHaveLength(0); // Should be below suggest threshold
    });
  });

  describe('getMatchType', () => {
    it('should classify match types correctly', () => {
      expect(engine.getMatchType(0.95)).toBe('auto');
      expect(engine.getMatchType(0.85)).toBe('auto');
      expect(engine.getMatchType(0.75)).toBe('suggested');
      expect(engine.getMatchType(0.5)).toBe('suggested');
      expect(engine.getMatchType(0.3)).toBe('manual');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      engine.updateConfig({
        amount_tolerance_percentage: 0.1,
        auto_match_threshold: 0.9
      });

      const config = engine.getConfig();
      expect(config.amount_tolerance_percentage).toBe(0.1);
      expect(config.auto_match_threshold).toBe(0.9);
    });
  });
});
