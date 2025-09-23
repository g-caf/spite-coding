/**
 * Location-based Matching
 * Handles geographic proximity and address comparison
 */

interface Location {
  latitude?: number;
  longitude?: number;
  address?: string;
}

export class LocationMatcher {
  private static readonly EARTH_RADIUS_KM = 6371;

  /**
   * Calculate distance between two geographic points using Haversine formula
   */
  calculateDistance(location1: Location, location2: Location): number {
    if (!this.hasValidCoordinates(location1) || !this.hasValidCoordinates(location2)) {
      return Infinity;
    }

    const lat1Rad = this.toRadians(location1.latitude!);
    const lat2Rad = this.toRadians(location2.latitude!);
    const deltaLatRad = this.toRadians(location2.latitude! - location1.latitude!);
    const deltaLonRad = this.toRadians(location2.longitude! - location1.longitude!);

    const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(deltaLonRad / 2) * Math.sin(deltaLonRad / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return LocationMatcher.EARTH_RADIUS_KM * c;
  }

  /**
   * Compare two addresses for similarity
   */
  compareAddresses(address1?: string, address2?: string): boolean {
    if (!address1 || !address2) {
      return false;
    }

    const normalized1 = this.normalizeAddress(address1);
    const normalized2 = this.normalizeAddress(address2);

    // Exact match after normalization
    if (normalized1 === normalized2) {
      return true;
    }

    // Check if one address contains the other (useful for detailed vs basic addresses)
    const longer = normalized1.length > normalized2.length ? normalized1 : normalized2;
    const shorter = normalized1.length > normalized2.length ? normalized2 : normalized1;

    if (longer.includes(shorter) && shorter.length > 10) {
      return true;
    }

    // Extract key components and compare
    const components1 = this.extractAddressComponents(normalized1);
    const components2 = this.extractAddressComponents(normalized2);

    return this.compareAddressComponents(components1, components2);
  }

  /**
   * Normalize address string for comparison
   */
  private normalizeAddress(address: string): string {
    return address
      .toLowerCase()
      .trim()
      // Standardize common abbreviations
      .replace(/\bstreet\b/g, 'st')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\bboulevard\b/g, 'blvd')
      .replace(/\bdriver\b/g, 'dr')
      .replace(/\broad\b/g, 'rd')
      .replace(/\blane\b/g, 'ln')
      .replace(/\bcourt\b/g, 'ct')
      .replace(/\bplace\b/g, 'pl')
      .replace(/\bsuite\b/g, 'ste')
      .replace(/\bapartment\b/g, 'apt')
      .replace(/\bnorth\b/g, 'n')
      .replace(/\bsouth\b/g, 's')
      .replace(/\beast\b/g, 'e')
      .replace(/\bwest\b/g, 'w')
      // Remove extra whitespace and punctuation
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract key components from normalized address
   */
  private extractAddressComponents(normalizedAddress: string): {
    streetNumber?: string;
    streetName?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  } {
    const words = normalizedAddress.split(' ');
    const components: any = {};

    // Extract street number (usually first number)
    const streetNumberMatch = normalizedAddress.match(/^\d+/);
    if (streetNumberMatch) {
      components.streetNumber = streetNumberMatch[0];
    }

    // Extract ZIP code (5 or 9 digits)
    const zipMatch = normalizedAddress.match(/\b\d{5}(?:-\d{4})?\b/);
    if (zipMatch) {
      components.zipCode = zipMatch[0];
    }

    // Extract state (2-letter abbreviation)
    const stateMatch = normalizedAddress.match(/\b[a-z]{2}\b/);
    if (stateMatch) {
      components.state = stateMatch[0];
    }

    // Simplified street name extraction (between number and city)
    if (components.streetNumber) {
      const afterNumber = normalizedAddress.substring(components.streetNumber.length).trim();
      const streetParts = afterNumber.split(' ');
      if (streetParts.length > 0) {
        components.streetName = streetParts[0];
      }
    }

    return components;
  }

  /**
   * Compare extracted address components
   */
  private compareAddressComponents(
    components1: any,
    components2: any
  ): boolean {
    // Same street number and name is a strong indicator
    if (components1.streetNumber && components2.streetNumber &&
        components1.streetName && components2.streetName) {
      if (components1.streetNumber === components2.streetNumber &&
          components1.streetName === components2.streetName) {
        return true;
      }
    }

    // Same ZIP code is also a strong indicator for nearby locations
    if (components1.zipCode && components2.zipCode) {
      if (components1.zipCode === components2.zipCode) {
        return true;
      }
    }

    // Same state and similar street info
    if (components1.state && components2.state && 
        components1.state === components2.state) {
      if ((components1.streetName && components2.streetName &&
           components1.streetName === components2.streetName) ||
          (components1.zipCode && components2.zipCode &&
           components1.zipCode === components2.zipCode)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if location has valid coordinates
   */
  private hasValidCoordinates(location: Location): boolean {
    return typeof location.latitude === 'number' &&
           typeof location.longitude === 'number' &&
           !isNaN(location.latitude) &&
           !isNaN(location.longitude) &&
           Math.abs(location.latitude) <= 90 &&
           Math.abs(location.longitude) <= 180;
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Get approximate distance category for logging/display
   */
  getDistanceCategory(distanceKm: number): string {
    if (distanceKm === Infinity) return 'unknown';
    if (distanceKm < 0.1) return 'same_location';
    if (distanceKm < 0.5) return 'very_close';
    if (distanceKm < 2) return 'nearby';
    if (distanceKm < 10) return 'same_area';
    if (distanceKm < 50) return 'same_city';
    return 'distant';
  }

  /**
   * Extract city from address string (simple heuristic)
   */
  extractCity(address: string): string | undefined {
    const normalized = this.normalizeAddress(address);
    const parts = normalized.split(' ');
    
    // Look for patterns like "City, ST ZIP" or "City ST ZIP"
    for (let i = 0; i < parts.length - 2; i++) {
      const possibleState = parts[i + 1];
      const possibleZip = parts[i + 2];
      
      if (possibleState.length === 2 && /^\d{5}/.test(possibleZip)) {
        return parts[i];
      }
    }

    return undefined;
  }

  /**
   * Check if two locations are in the same city
   */
  inSameCity(location1: Location, location2: Location): boolean {
    if (!location1.address || !location2.address) {
      return false;
    }

    const city1 = this.extractCity(location1.address);
    const city2 = this.extractCity(location2.address);

    return city1 !== undefined && city2 !== undefined && city1 === city2;
  }
}
