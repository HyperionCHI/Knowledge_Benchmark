export type CategoryRecord = {
  id: string;
  name: string;
  description: string;
  color: string;
  termCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TermRecord = {
  id: string;
  categoryId: string;
  chinese: string;
  abbreviation: string;
  english: string;
  definition: string;
  scenario: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};
