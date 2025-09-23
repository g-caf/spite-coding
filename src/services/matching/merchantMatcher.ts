/**
 * Merchant Name Matching and Normalization
 * Handles fuzzy matching, canonicalization, and learning from user feedback
 */

import { MerchantMapping } from './types.js';
import { logger } from '../../utils/logger.js';

interface MerchantComparisonResult {
  similarity: number;
  canonical_name?: string;
  confidence: number;
}

export class MerchantMatcher {
  private merchantMappings = new Map<string, MerchantMapping[]>();
  private commonReplacements: Record<string, string> = {
    // Common abbreviations and variations
    'inc': '',
    'llc': '',
    'ltd': '',
    'corp': '',
    'corporation': '',
    'company': '',
    'co': '',
    '&': 'and',
    '#': '',
    '*': '',
    // Location indicators to remove
    'store': '',
    'shop': '',
    'branch': '',
    // Payment processor prefixes
    'sq *': '', // Square
    'ssp*': '', // Some payment processor
    'paypal *': '',
    'venmo *': '',
    // Common suffixes
    ' - recurring': '',
    ' recurring': '',
    ' payment': '',
    ' autopay': ''
  };

  private stopWords = new Set([
    'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'store', 'shop', 'market', 'restaurant', 'cafe', 'bar', 'pub', 'hotel', 'motel'
  ]);

  /**
   * Compare two merchant names and return similarity score
   */
  async compareNames(
    name1: string,
    name2: string,
    organizationId: string
  ): Promise<MerchantComparisonResult> {
    if (!name1 || !name2) {
      return { similarity: 0, confidence: 0 };
    }

    // Normalize both names
    const normalized1 = this.normalizeMerchantName(name1);
    const normalized2 = this.normalizeMerchantName(name2);

    // Check for exact match after normalization
    if (normalized1 === normalized2) {
      return { 
        similarity: 1.0,
        canonical_name: await this.getCanonicalName(normalized1, organizationId),
        confidence: 1.0
      };
    }

    // Calculate various similarity metrics
    const metrics = {
      levenshtein: this.calculateLevenshteinSimilarity(normalized1, normalized2),
      jaccard: this.calculateJaccardSimilarity(normalized1, normalized2),
      substring: this.calculateSubstringSimilarity(normalized1, normalized2),
      wordOrder: this.calculateWordOrderSimilarity(normalized1, normalized2),
      phonetic: this.calculatePhoneticSimilarity(normalized1, normalized2)
    };

    // Weighted combination of metrics
    const similarity = (
      metrics.levenshtein * 0.3 +
      metrics.jaccard * 0.25 +
      metrics.substring * 0.2 +
      metrics.wordOrder * 0.15 +
      metrics.phonetic * 0.1
    );

    const canonical_name = similarity > 0.7 
      ? await this.getCanonicalName(normalized1, organizationId) || await this.getCanonicalName(normalized2, organizationId)
      : undefined;

    return {
      similarity: Math.min(1.0, similarity),
      canonical_name,
      confidence: this.calculateConfidence(metrics, normalized1, normalized2)
    };
  }

  /**
   * Normalize merchant name for better matching
   */
  private normalizeMerchantName(name: string): string {
    let normalized = name.toLowerCase().trim();

    // Remove common payment processor prefixes and suffixes
    for (const [pattern, replacement] of Object.entries(this.commonReplacements)) {
      const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      normalized = normalized.replace(regex, replacement);
    }

    // Remove special characters and extra spaces
    normalized = normalized
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Remove location indicators (like city names, store numbers)
    normalized = normalized.replace(/\b\d{3,}\b/g, ''); // Remove long numbers (store IDs)
    normalized = normalized.replace(/\b(store|shop|location|branch)\s*\d+\b/gi, '');

    // Remove common stop words
    const words = normalized.split(' ').filter(word => 
      word.length > 0 && !this.stopWords.has(word)
    );

    return words.join(' ').trim();
  }

  /**
   * Calculate Levenshtein distance similarity
   */
  private calculateLevenshteinSimilarity(str1: string, str2: string): number {
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0;
    
    const distance = this.levenshteinDistance(str1, str2);
    return 1 - (distance / maxLength);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + substitutionCost // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate Jaccard similarity (based on character n-grams)
   */
  private calculateJaccardSimilarity(str1: string, str2: string): number {
    const ngrams1 = this.generateNGrams(str1, 2);
    const ngrams2 = this.generateNGrams(str2, 2);

    const set1 = new Set(ngrams1);
    const set2 = new Set(ngrams2);

    const intersection = new Set(Array.from(set1).filter(x => set2.has(x)));
    const union = new Set([...Array.from(set1), ...Array.from(set2)]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private generateNGrams(str: string, n: number): string[] {
    const ngrams: string[] = [];
    for (let i = 0; i <= str.length - n; i++) {
      ngrams.push(str.substr(i, n));
    }
    return ngrams;
  }

  /**
   * Calculate substring similarity
   */
  private calculateSubstringSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(' ');
    const words2 = str2.split(' ');

    let matches = 0;
    let total = Math.max(words1.length, words2.length);

    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1.includes(word2) || word2.includes(word1)) {
          matches++;
          break;
        }
      }
    }

    return total > 0 ? matches / total : 0;
  }

  /**
   * Calculate word order similarity
   */
  private calculateWordOrderSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(' ');
    const words2 = str2.split(' ');

    if (words1.length === 0 && words2.length === 0) return 1.0;
    if (words1.length === 0 || words2.length === 0) return 0;

    // Find common words
    const commonWords = words1.filter(word => words2.includes(word));
    
    if (commonWords.length === 0) return 0;

    // Calculate position similarity for common words
    let positionSimilarity = 0;
    for (const word of commonWords) {
      const pos1 = words1.indexOf(word) / words1.length;
      const pos2 = words2.indexOf(word) / words2.length;
      positionSimilarity += 1 - Math.abs(pos1 - pos2);
    }

    const averagePositionSimilarity = positionSimilarity / commonWords.length;
    const wordCoverage = commonWords.length / Math.max(words1.length, words2.length);

    return averagePositionSimilarity * wordCoverage;
  }

  /**
   * Calculate phonetic similarity (simplified Soundex-like approach)
   */
  private calculatePhoneticSimilarity(str1: string, str2: string): number {
    const phonetic1 = this.getPhoneticCode(str1);
    const phonetic2 = this.getPhoneticCode(str2);

    return phonetic1 === phonetic2 ? 1.0 : 0.0;
  }

  private getPhoneticCode(str: string): string {
    // Simplified phonetic encoding
    return str
      .replace(/[aeiou]/g, '0')
      .replace(/[bp]/g, '1')
      .replace(/[fv]/g, '2')
      .replace(/[cgjkqsxz]/g, '3')
      .replace(/[dt]/g, '4')
      .replace(/[l]/g, '5')
      .replace(/[mn]/g, '6')
      .replace(/[r]/g, '7')
      .replace(/[hw]/g, '8')
      .replace(/[y]/g, '9')
      .replace(/0+/g, '0')
      .substring(0, 6);
  }

  /**
   * Calculate overall confidence in the similarity score
   */
  private calculateConfidence(
    metrics: Record<string, number>,
    str1: string,
    str2: string
  ): number {
    // Higher confidence for longer strings and consistent metrics
    const lengthFactor = Math.min(str1.length, str2.length) / Math.max(str1.length, str2.length);
    
    const metricValues = Object.values(metrics);
    const metricVariance = this.calculateVariance(metricValues);
    const consistencyFactor = 1 - Math.min(metricVariance, 1);

    return (lengthFactor + consistencyFactor) / 2;
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 1;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
    return squaredDifferences.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Get canonical name for a merchant (from cached mappings)
   */
  private async getCanonicalName(
    normalizedName: string,
    organizationId: string
  ): Promise<string | undefined> {
    const mappings = this.merchantMappings.get(organizationId) || [];
    
    for (const mapping of mappings) {
      if (mapping.raw_names.some(name => 
        this.normalizeMerchantName(name) === normalizedName
      )) {
        return mapping.canonical_name;
      }
    }

    return undefined;
  }

  /**
   * Learn from user feedback to improve future matching
   */
  async learnFromFeedback(
    organizationId: string,
    rawName1: string,
    rawName2: string,
    shouldMatch: boolean,
    canonicalName?: string
  ): Promise<void> {
    logger.info('Learning from merchant matching feedback', {
      organization_id: organizationId,
      raw_name_1: rawName1,
      raw_name_2: rawName2,
      should_match: shouldMatch,
      canonical_name: canonicalName
    });

    if (shouldMatch && canonicalName) {
      await this.createOrUpdateMapping(organizationId, [rawName1, rawName2], canonicalName);
    }

    // In a real implementation, this would also update ML model weights
    // and store negative examples for improved disambiguation
  }

  /**
   * Create or update merchant mapping
   */
  private async createOrUpdateMapping(
    organizationId: string,
    rawNames: string[],
    canonicalName: string
  ): Promise<void> {
    const mappings = this.merchantMappings.get(organizationId) || [];
    
    // Find existing mapping
    let existingMapping = mappings.find(m => m.canonical_name === canonicalName);
    
    if (existingMapping) {
      // Update existing mapping
      existingMapping.raw_names = Array.from(new Set([...existingMapping.raw_names, ...rawNames]));
      existingMapping.usage_count++;
      existingMapping.last_used = new Date();
    } else {
      // Create new mapping
      const newMapping: MerchantMapping = {
        id: `mapping-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        organization_id: organizationId,
        raw_names: rawNames,
        canonical_name: canonicalName,
        confidence: 0.8,
        created_from: 'manual',
        verified: true,
        usage_count: 1,
        last_used: new Date()
      };
      
      mappings.push(newMapping);
    }

    this.merchantMappings.set(organizationId, mappings);
  }

  /**
   * Get all merchant mappings for an organization
   */
  async getMappings(organizationId: string): Promise<MerchantMapping[]> {
    return this.merchantMappings.get(organizationId) || [];
  }

  /**
   * Load merchant mappings from database
   */
  async loadMappings(organizationId: string): Promise<void> {
    // In a real implementation, this would load from database
    // For now, we'll keep empty mappings that get built over time
    if (!this.merchantMappings.has(organizationId)) {
      this.merchantMappings.set(organizationId, []);
    }
  }
}
