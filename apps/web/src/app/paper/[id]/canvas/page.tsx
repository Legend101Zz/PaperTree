'use client';

import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { PaperCanvas } from '@/components/canvas/PaperCanvas';
import { Button } from '@/components/ui/Button';
import { papersApi, canvasApi } from '@/lib/api';
import { ChevronLeft, BookOpen } from 'lucide-react';
import { Node, Edge } from 'reactflow';

export default function CanvasPage() {
    const params = useParams();
    const router = useRouter();
    const paperId = params.id as string;

    // Fetch paper
    const { data: paper } = useQuery({
        queryKey: ['paper', paperId],
        queryFn: () => papersApi.get(paperId),
    });

    // Fetch canvas
    const { data: canvas, isLoading } = useQuery({
        queryKey: ['canvas', paperId],
        queryFn: () => canvasApi.get(paperId),
    });

    // Save canvas mutation
    const saveMutation = useMutation({
        mutationFn: (elements: { nodes: Node[]; edges: Edge[] }) =>
            canvasApi.update(paperId, elements),
    });

    const handleSave = useCallback((nodes: Node[], edges: Edge[]) => {
        saveMutation.mutate({ nodes, edges });
    }, [saveMutation]);

    const handleNodeClick = useCallback((nodeId: string, nodeType: string, data: any) => {
        if (nodeType === 'highlight' && data.highlightId) {
            // Navigate to reader with highlight focused
            router.push(`/paper/${paperId}/read?highlight=${data.highlightId}`);
        }
    }, [router, paperId]);

    // Initialize canvas with paper node if empty
    const initialNodes: Node[] = canvas?.elements?.nodes || [
        {
            id: `paper-${paperId}`,
            type: 'paper',
            position: { x: 400, y: 50 },
            data: { label: paper?.title || 'Paper' },
        },
    ];

    const initialEdges: Edge[] = canvas?.elements?.edges || [];

    if (isLoading) {
        return (
            <AuthGuard>
                <div className="min-h-screen flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
                </div>
            </AuthGuard>
        );
    }

    return (
        <AuthGuard>
            <div className="h-screen flex flex-col">
                {/* Toolbar */}
                <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push('/dashboard')}
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <h1 className="font-medium">{paper?.title} - Canvas</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">
                            {saveMutation.isPending ? 'Saving...' : 'Auto-saved'}
                        </span>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => router.push(`/paper/${paperId}/read`)}
                        >
                            <BookOpen className="w-4 h-4 mr-1" />
                            Reader
                        </Button>
                    </div>
                </div>

                {/* Canvas */}
                <div className="flex-1">
                    <PaperCanvas
                        initialNodes={initialNodes}
                        initialEdges={initialEdges}
                        onSave={handleSave}
                        onNodeClick={handleNodeClick}
                    />
                </div>
            </div>
        </AuthGuard>
    );
}