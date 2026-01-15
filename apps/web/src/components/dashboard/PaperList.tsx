'use client';

import { Paper } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatDate } from '@/lib/utils';
import { FileText, Trash2, BookOpen, Layout } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface PaperListProps {
    papers: Paper[];
    onDelete: (id: string) => void;
    isDeleting: boolean;
}

export function PaperList({ papers, onDelete, isDeleting }: PaperListProps) {
    const router = useRouter();

    if (papers.length === 0) {
        return (
            <div className="text-center py-12">
                <FileText className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">No papers yet</h3>
                <p className="text-gray-500 mt-2">Upload your first research paper to get started</p>
            </div>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {papers.map((paper) => (
                <Card key={paper.id} className="p-4">
                    <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-gray-900 dark:text-white truncate">
                                {paper.title}
                            </h3>
                            <p className="text-sm text-gray-500 mt-1">
                                {formatDate(paper.created_at)}
                            </p>
                            {paper.page_count && (
                                <p className="text-sm text-gray-500">
                                    {paper.page_count} pages
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => router.push(`/paper/${paper.id}/read`)}
                            className="flex-1"
                        >
                            <BookOpen className="w-4 h-4 mr-1" />
                            Read
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => router.push(`/paper/${paper.id}/canvas`)}
                        >
                            <Layout className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDelete(paper.id)}
                            disabled={isDeleting}
                        >
                            <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                    </div>
                </Card>
            ))}
        </div>
    );
}