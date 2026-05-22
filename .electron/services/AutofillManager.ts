import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { SavedAddress } from '../../src/types/browser';

export class AutofillManager {
  private addressesPath: string;
  private addresses: SavedAddress[];

  constructor() {
    this.addressesPath = path.join(app.getPath('userData'), 'addresses.json');
    this.addresses = this.load();
  }

  private load(): SavedAddress[] {
    try {
      return JSON.parse(fs.readFileSync(this.addressesPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.addressesPath, JSON.stringify(this.addresses, null, 2));
  }

  getAddresses(): SavedAddress[] {
    return this.addresses;
  }

  saveAddress(address: SavedAddress): SavedAddress {
    if (!address.id) address.id = uuidv4();
    const index = this.addresses.findIndex((a) => a.id === address.id);
    if (index >= 0) {
      this.addresses[index] = address;
    } else {
      this.addresses.push(address);
    }
    this.save();
    return address;
  }

  removeAddress(addressId: string): void {
    this.addresses = this.addresses.filter((a) => a.id !== addressId);
    this.save();
  }
}
