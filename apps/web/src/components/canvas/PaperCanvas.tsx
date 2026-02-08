// apps/web/src/components/canvas/PaperCanvas.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
    Node,
    Edge,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    Background,
    Controls,
    MiniMap,
    NodeTypes,
    Panel,
    useReactFlow,
    BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { RichCanvasNode } from './RichCanvasNode';
import { useCanvasStore } from '@/store/canvasStore';
import { canvasApi } from '@/lib/api';

import { AskMode, CanvasNode as CanvasNodeType, CanvasEdge as CanvasEdgeType, CanvasNodeType as NodeTypeEnum } from '@/types';
import {
    Save, RefreshCw, Layout, Trash2, Plus, Loader2,
    ZoomIn, ZoomOut, Maximize, Grid3X3
} from 'lucide-react';
import { CanvasAIPanel } from './CanvasAIPanel';
import { CanvasToolbar } from './CanvasToolbar';



// Convert our CanvasNode to ReactFlow Node
function toReactFlowNode(node: CanvasNodeType, callbacks: {
    onToggleCollapse: (id: string) => void;
    onDelete: (id: string) => void;
    onNavigateToSource: (node: CanvasNodeType) => void;
}): Node {
    return {
        id: node.id,
        type: 'richNode',
        position: node.position,
        data: {
            ...node.data,
            nodeType: node.type,
            onToggleCollapse: () => callbacks.onToggleCollapse(node.id),
            onDelete: () => callbacks.onDelete(node.id),
            onNavigateToSource: () => callbacks.onNavigateToSource(node),
        },
    };
}

// Convert ReactFlow Node back to our format
function fromReactFlowNode(node: Node, originalNode?: CanvasNodeType): CanvasNodeType {
    return {
        id: node.id,
        type: (originalNode?.type || 'note') as NodeTypeEnum,
        position: node.position,
        data: {
            label: node.data.label || 'Untitled',
            content: node.data.content,
            content_type: node.data.content_type || 'markdown',
            excerpt: node.data.excerpt,
            question: node.data.question,
            ask_mode: node.data.ask_mode,
            source: node.data.source,
            highlight_id: node.data.highlight_id,
            explanation_id: node.data.explanation_id,
            is_collapsed: node.data.is_collapsed || false,
            tags: node.data.tags || [],
            color: node.data.color,
            created_at: node.data.created_at,
            updated_at: node.data.updated_at,
        },
        parent_id: originalNode?.parent_id,
        children_ids: originalNode?.children_ids || [],
    };
}

// Convert our Edge to ReactFlow Edge
function toReactFlowEdge(edge: CanvasEdgeType): Edge {
    return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: edge.edge_type === 'followup' ? 'smoothstep' : 'default',
        animated: edge.edge_type === 'followup',
        style: {
            strokeWidth: edge.edge_type === 'followup' ? 2 : 1,
            stroke: edge.edge_type === 'followup' ? '#06b6d4' : '#94a3b8',
        },
    };
}

interface PaperCanvasProps {
    paperId: string;
    initialNodes: CanvasNodeType[];
    initialEdges: CanvasEdgeType[];
    onSave: (nodes: CanvasNodeType[], edges: CanvasEdgeType[]) => void;
    onNodeClick: (nodeId: string, nodeType: string, data: any) => void;
}

// Define node types
const nodeTypes: NodeTypes = {
    richNode: RichCanvasNode,
};

export function PaperCanvas({
    paperId,
    initialNodes,
    initialEdges,
    onSave,
    onNodeClick,
}: PaperCanvasProps) {
    const { fitView, zoomIn, zoomOut, setCenter } = useReactFlow();
    const [isSaving, setIsSaving] = useState(false);
    const [isLayouting, setIsLayouting] = useState(false);
    // AI Panel state
    const [aiPanelState, setAiPanelState] = useState<{
        nodeId: string;
        nodeLabel: string;
        position: { x: number; y: number };
    } | null>(null);
    const [isAiQuerying, setIsAiQuerying] = useState(false);
    const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);

    // Store
    const storeNodes = useCanvasStore((s) => s.nodes);
    const storeEdges = useCanvasStore((s) => s.edges);
    const setStoreNodes = useCanvasStore((s) => s.setNodes);
    const setStoreEdges = useCanvasStore((s) => s.setEdges);
    const toggleNodeCollapse = useCanvasStore((s) => s.toggleNodeCollapse);
    const removeNode = useCanvasStore((s) => s.removeNode);
    const isDirty = useCanvasStore((s) => s.isDirty);
    const markSaved = useCanvasStore((s) => s.markSaved);

    // Initialize store from props
    useEffect(() => {
        setStoreNodes(initialNodes);
        setStoreEdges(initialEdges);
    }, [initialNodes, initialEdges, setStoreNodes, setStoreEdges]);

    // Callbacks for nodes
    const nodeCallbacks = useMemo(() => ({
        onToggleCollapse: (id: string) => {
            toggleNodeCollapse(id);
        },
        onDelete: (id: string) => {
            if (confirm('Delete this node and all its children?')) {
                removeNode(id);
            }
        },
        onNavigateToSource: (node: CanvasNodeType) => {
            if (node.data.source) {
                onNodeClick(node.id, node.type, node.data);
            }
        },
    }), [toggleNodeCollapse, removeNode, onNodeClick]);

    // Convert to ReactFlow format
    const rfNodes = useMemo(() =>
        storeNodes.map((n) => toReactFlowNode(n, nodeCallbacks)),
        [storeNodes, nodeCallbacks]
    );

    const rfEdges = useMemo(() =>
        storeEdges.map(toReactFlowEdge),
        [storeEdges]
    );

    // ReactFlow state
    const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

    // Sync ReactFlow state with store
    useEffect(() => {
        setNodes(rfNodes);
    }, [rfNodes, setNodes]);

    useEffect(() => {
        setEdges(rfEdges);
    }, [rfEdges, setEdges]);

    // Handle connections
    const onConnect = useCallback(
        (params: Connection) => {
            setEdges((eds) => addEdge(params, eds));
        },
        [setEdges]
    );

    // Handle node position changes
    const onNodeDragStop = useCallback(
        (_: React.MouseEvent, node: Node) => {
            const updatedNodes = storeNodes.map((n) =>
                n.id === node.id ? { ...n, position: node.position } : n
            );
            setStoreNodes(updatedNodes);
        },
        [storeNodes, setStoreNodes]
    );

    // Save to backend
    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            // Convert current ReactFlow nodes back
            const canvasNodes = nodes.map((n) => {
                const originalNode = storeNodes.find((sn) => sn.id === n.id);
                return fromReactFlowNode(n, originalNode);
            });

            const canvasEdges: CanvasEdgeType[] = edges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                label: e.label as string | undefined,
                edge_type: e.animated ? 'followup' : 'default',
            }));

            await canvasApi.update(paperId, { nodes: canvasNodes, edges: canvasEdges });
            markSaved();
            onSave(canvasNodes, canvasEdges);
        } catch (error) {
            console.error('Failed to save canvas:', error);
            alert('Failed to save. Please try again.');
        } finally {
            setIsSaving(false);
        }
    }, [nodes, edges, storeNodes, paperId, markSaved, onSave]);

    // Auto-save on changes (debounced)
    useEffect(() => {
        if (!isDirty) return;

        const timeout = setTimeout(() => {
            handleSave();
        }, 2000);

        return () => clearTimeout(timeout);
    }, [isDirty, handleSave]);

    // Auto-layout
    const handleAutoLayout = useCallback(async (algorithm: 'tree' | 'grid' = 'tree') => {
        setIsLayouting(true);
        try {
            await canvasApi.autoLayout(paperId, algorithm);
            // Refetch canvas
            const updated = await canvasApi.get(paperId);
            setStoreNodes(updated.elements.nodes);
            setStoreEdges(updated.elements.edges);

            // Fit view after layout
            setTimeout(() => fitView({ padding: 0.2 }), 100);
        } catch (error) {
            console.error('Failed to auto-layout:', error);
        } finally {
            setIsLayouting(false);
        }
    }, [paperId, setStoreNodes, setStoreEdges, fitView]);

    // Handle node click
    const handleNodeClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            const originalNode = storeNodes.find((n) => n.id === node.id);
            if (originalNode) {
                onNodeClick(node.id, originalNode.type, originalNode.data);
            }
        },
        [storeNodes, onNodeClick]
    );

    // Handle right-click on node → show AI panel
    const handleNodeContextMenu = useCallback(
        (event: React.MouseEvent, node: Node) => {
            event.preventDefault();
            setAiPanelState({
                nodeId: node.id,
                nodeLabel: node.data.label || 'Node',
                position: { x: event.clientX, y: event.clientY },
            });
        },
        []
    );
    // Handle AI query from panel
    const handleAIQuery = useCallback(
        async (question: string, askMode: AskMode) => {
            if (!aiPanelState || isAiQuerying) return;
            setIsAiQuerying(true);
            try {
                const result = await canvasApi.aiQuery(paperId, {
                    parent_node_id: aiPanelState.nodeId,
                    question,
                    ask_mode: askMode,
                    include_paper_context: true,
                });

                // Add new node + edge to store
                const store = useCanvasStore.getState();
                store.addNode(result.node);
                store.addEdge(result.edge);

                setAiPanelState(null);
            } catch (error) {
                console.error('AI query failed:', error);
                alert('AI query failed. Please try again.');
            } finally {
                setIsAiQuerying(false);
            }
        },
        [aiPanelState, isAiQuerying, paperId]
    );

    // Handle template creation
    const handleCreateTemplate = useCallback(
        async (template: 'summary_tree' | 'question_branch' | 'critique_map' | 'concept_map') => {
            setIsCreatingTemplate(true);
            try {
                await canvasApi.createTemplate(paperId, template);
                // Refetch canvas
                const updated = await canvasApi.get(paperId);
                setStoreNodes(updated.elements.nodes);
                setStoreEdges(updated.elements.edges);
                setTimeout(() => fitView({ padding: 0.2 }), 100);
            } catch (error) {
                console.error('Template creation failed:', error);
            } finally {
                setIsCreatingTemplate(false);
            }
        },
        [paperId, setStoreNodes, setStoreEdges, fitView]
    );

    // Handle adding a blank note node
    const handleAddNote = useCallback(() => {
        const store = useCanvasStore.getState();
        const newNode: CanvasNodeType = {
            id: `node_${Date.now().toString(36)}`,
            type: 'note',
            position: { x: 200 + Math.random() * 400, y: 300 + Math.random() * 200 },
            data: {
                label: 'New Note',
                content: 'Click to edit...',
                content_type: 'plain',
                is_collapsed: false,
                tags: [],
            },
        };
        store.addNode(newNode);
    }, []);

    return (
        <div className="w-full h-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onNodeClick={handleNodeClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.1}
                maxZoom={2}
                className="bg-gray-50 dark:bg-gray-950"
                proOptions={{ hideAttribution: true }}
            >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} />

                <Controls showZoom={false} showFitView={false} showInteractive={false}>
                    <button
                        onClick={() => zoomIn()}
                        className="react-flow__controls-button"
                        title="Zoom in"
                    >
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => zoomOut()}
                        className="react-flow__controls-button"
                        title="Zoom out"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => fitView({ padding: 0.2 })}
                        className="react-flow__controls-button"
                        title="Fit view"
                    >
                        <Maximize className="w-4 h-4" />
                    </button>
                </Controls>

                {/* Template toolbar */}
                <Panel position="top-center" className="flex gap-2">
                    <CanvasToolbar
                        onCreateTemplate={handleCreateTemplate}
                        onAddNote={handleAddNote}
                        isCreating={isCreatingTemplate}
                    />
                </Panel>

                <MiniMap
                    nodeStrokeWidth={3}
                    zoomable
                    pannable
                    className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700"
                />

                {/* Top toolbar */}
                <Panel position="top-right" className="flex items-center gap-2">
                    {/* Save status */}
                    <div className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 ${isDirty
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                        : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        }`}>
                        {isSaving ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Saving...</span>
                            </>
                        ) : isDirty ? (
                            <>
                                <div className="w-2 h-2 rounded-full bg-amber-500" />
                                <span>Unsaved</span>
                            </>
                        ) : (
                            <>
                                <div className="w-2 h-2 rounded-full bg-green-500" />
                                <span>Saved</span>
                            </>
                        )}
                    </div>

                    {/* Manual save */}
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !isDirty}
                        className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 
                            hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                        title="Save now"
                    >
                        <Save className="w-4 h-4" />
                    </button>

                    {/* Auto-layout */}
                    <div className="flex items-center bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
                        <button
                            onClick={() => handleAutoLayout('tree')}
                            disabled={isLayouting}
                            className="p-2 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 border-r border-gray-200 dark:border-gray-700"
                            title="Tree layout"
                        >
                            {isLayouting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Layout className="w-4 h-4" />
                            )}
                        </button>
                        <button
                            onClick={() => handleAutoLayout('grid')}
                            disabled={isLayouting}
                            className="p-2 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                            title="Grid layout"
                        >
                            <Grid3X3 className="w-4 h-4" />
                        </button>
                    </div>
                </Panel>

                {/* Stats panel */}
                <Panel position="bottom-left" className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 px-3 py-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        {nodes.length} nodes · {edges.length} connections
                    </div>
                </Panel>
            </ReactFlow>
            {/* AI Panel overlay */}
            {aiPanelState && (
                <div
                    className="fixed z-50"
                    style={{
                        top: Math.min(aiPanelState.position.y, window.innerHeight - 350),
                        left: Math.min(aiPanelState.position.x, window.innerWidth - 340),
                    }}
                >
                    <CanvasAIPanel
                        nodeId={aiPanelState.nodeId}
                        nodeLabel={aiPanelState.nodeLabel}
                        onQuery={handleAIQuery}
                        onClose={() => setAiPanelState(null)}
                        isQuerying={isAiQuerying}
                    />
                </div>
            )}
        </div>
    );
}