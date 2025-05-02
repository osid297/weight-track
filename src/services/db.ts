import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface WeightEntry {
  date: string;
  weight: number;
}

interface WeightTrackerDB extends DBSchema {
  entries: {
    key: string;
    value: WeightEntry;
  };
}

class DatabaseService {
  private db: IDBPDatabase<WeightTrackerDB> | null = null;

  async init() {
    this.db = await openDB<WeightTrackerDB>('weight-tracker', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('entries')) {
          db.createObjectStore('entries', { keyPath: 'date' });
        }
      },
    });
  }

  async getEntries(): Promise<WeightEntry[]> {
    if (!this.db) await this.init();
    return (await this.db!.getAll('entries')).sort((a, b) => a.date.localeCompare(b.date));
  }

  async addEntry(entry: WeightEntry) {
    if (!this.db) await this.init();
    await this.db!.put('entries', entry);
  }

  async removeEntry(date: string) {
    if (!this.db) await this.init();
    await this.db!.delete('entries', date);
  }
}

export const db = new DatabaseService(); 