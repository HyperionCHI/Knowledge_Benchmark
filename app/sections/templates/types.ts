export type TemplateRecord = {
  id: string;
  title: string;
  categoryId: string;
  category: string;
  summary: string;
  content: string;
  attachmentName: string | null;
  attachmentSize: number | null;
  createdAt: string;
  updatedAt: string;
};

export type TemplateCategory = {
  id: string;
  name: string;
  description: string;
  color: string;
  templateCount: number;
  createdAt: string;
  updatedAt: string;
};
