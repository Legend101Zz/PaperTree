// apps/web/src/app/paper/[id]/canvas/page.tsx
'use client';

import { useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ReactFlowProvider } from 'reactflow';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { PaperCanvas } from '@/components/canvas/PaperCanvas';
import { Button } from '@/components/ui/Button';
import { papersApi, canvasApi } from '@/lib/api';
import { ChevronLeft, BookOpen, Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { CanvasNode, CanvasEdge, Canvas } from '@/types';

export default function CanvasPage() {
    const params = useParams();
    const router = useRouter();
    const queryClient = useQueryClient();
    const paperId = params.id as string;

    // Fetch paper
    const { data: paper, isLoading: paperLoading } = useQuery({
        queryKey: ['paper', paperId],
        queryFn: () => papersApi.get(paperId),
    });

    // Fetch canvas
    const { data: canvas, isLoading: canvasLoading, refetch: refetchCanvas } = useQuery({
        queryKey: ['canvas', paperId],
        queryFn: () => canvasApi.get(paperId) as Promise<Canvas>,
    });

    // Save canvas mutation
    const saveMutation = useMutation({
        mutationFn: (elements: { nodes: CanvasNode[]; edges: CanvasEdge[] }) =>
            canvasApi.update(paperId, elements),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['canvas', paperId] });
        },
    });

    const handleSave = useCallback((nodes: CanvasNode[], edges: CanvasEdge[]) => {
        saveMutation.mutate({ nodes, edges });
    }, [saveMutation]);

    const handleNodeClick = useCallback((nodeId: string, nodeType: string, data: any) => {
        // Navigate to reader with highlight focused
        if (data.highlight_id) {
            router.push(`/paper/${paperId}/read?highlight=${data.highlight_id}`);
        } else if (data.source?.page_number) {
            router.push(`/paper/${paperId}/read?page=${data.source.page_number}`);
        }
    }, [router, paperId]);

    // Initialize canvas with paper node if empty
    const initialNodes: CanvasNode[] = useMemo(() => {
        if (canvas?.elements?.nodes?.length) {
            return canvas.elements.nodes;
        }
        return [{
            id: `paper-${paperId}`,
            type: 'paper',
            position: { x: 400, y: 50 },
            data: {
                label: paper?.title || 'Paper',
                content: paper?.book_content?.tldr || '',
                content_type: 'markdown',
                is_collapsed: false,
                tags: [],
            },
        }];
    }, [canvas, paperId, paper]);

    const initialEdges: CanvasEdge[] = useMemo(() =>
        canvas?.elements?.edges || [],
        [canvas]
    );

    const isLoading = paperLoading || canvasLoading;

    if (isLoading) {
        return (
            <AuthGuard>
                <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                        <p className="text-gray-500">Loading canvas...</p>
                    </div>
                </div>
            </AuthGuard>
        );
    }

    return (
        <AuthGuard>
            <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
                {/* Toolbar */}
                <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push('/dashboard')}
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <div>
                            <h1 className="font-medium text-sm sm:text-base truncate max-w-xs">
                                {paper?.title}
                            </h1>
                            <p className="text-xs text-gray-500">Canvas Workspace</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Refresh */}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => refetchCanvas()}
                            title="Refresh canvas"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </Button>

                        {/* Status */}
                        <span className="text-xs text-gray-500 hidden sm:inline">
                            {saveMutation.isPending ? 'Saving...' : 'Auto-saved'}
                        </span>

                        {/* Reader button */}
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => router.push(`/paper/${paperId}/read`)}
                        >
                            <BookOpen className="w-4 h-4 mr-1.5" />
                            <span className="hidden sm:inline">Reader</span>
                        </Button>
                    </div>
                </div>

                {/* Canvas */}
                <div className="flex-1 min-h-0">
                    <ReactFlowProvider>
                        <PaperCanvas
                            paperId={paperId}
                            initialNodes={initialNodes}
                            initialEdges={initialEdges}
                            onSave={handleSave}
                            onNodeClick={handleNodeClick}
                        />
                    </ReactFlowProvider>
                </div>

                {/* Help tooltip */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 px-4 py-2">
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span>💡 Right-click any node → Ask AI</span>
                        <span>•</span>
                        <span>Use Templates to start fast</span>
                        <span>•</span>
                        <span>Drag nodes to organize</span>
                        <span>•</span>
                        <span>Click source links to jump to paper</span>
                    </div>
                </div>
            </div>
        </AuthGuard>
    );
}