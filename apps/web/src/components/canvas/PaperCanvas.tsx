// apps/web/src/components/canvas/PaperCanvas.tsx
'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import ReactFlow, {
    Node, Edge, useNodesState, useEdgesState, addEdge, Connection,
    Background, Controls, MiniMap, NodeTypes, Panel, useReactFlow,
    BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { PageSuperNode } from './nodes/PageSuperNode';
import { ExplorationNode } from './nodes/ExplorationNode';
import { AIResponseNode } from './nodes/AIResponseNode';
import { NoteNode } from './nodes/NoteNode';
import { InlineAskInput } from './nodes/InlineAskInput';

import { canvasApi } from '@/lib/api';
import { useCanvasStore } from '@/store/canvasStore';
import type {
    CanvasNode as CanvasNodeType,
    CanvasEdge as CanvasEdgeType,
    AskMode,
    CanvasNodeType as NodeTypeEnum,
} from '@/types/canvas';
import {
    Save, RefreshCw, Layout, Plus, Loader2, Maximize,
    Grid3X3, StickyNote,
    Sparkles,
} from 'lucide-react';

// ──── Node type registry ────
const nodeTypes: NodeTypes = {
    paper: AIResponseNode,       // reuse for paper root
    page_super: PageSuperNode,
    exploration: ExplorationNode,
    ai_response: AIResponseNode,
    note: NoteNode,
};

// ──── Converters ────
function toReactFlowNode(
    node: CanvasNodeType,
    allNodes: CanvasNodeType[],
    callbacks: {
        onToggleCollapse: (id: string) => void;
        onDelete: (id: string) => void;
        onNavigateToSource: (node: CanvasNodeType) => void;
        onAskFollowup: (nodeId: string, pos: { x: number; y: number }) => void;
        onAddNote: (nodeId: string) => void;
        onUpdateNoteContent: (nodeId: string, content: string) => void;
    },
): Node {
    const childCount = allNodes.filter(n => n.parent_id === node.id).length;

    return {
        id: node.id,
        type: node.type,
        position: node.position,
        data: {
            ...node.data,
            children_count: childCount,
            onToggleCollapse: () => callbacks.onToggleCollapse(node.id),
            onDelete: () => callbacks.onDelete(node.id),
            onNavigateToSource: () => callbacks.onNavigateToSource(node),
            onAskFollowup: () => {
                // Calculate position near the node
                callbacks.onAskFollowup(node.id, {
                    x: node.position.x + 200,
                    y: node.position.y + 100,
                });
            },
            onAddNote: () => callbacks.onAddNote(node.id),
            onUpdateContent: (content: string) => callbacks.onUpdateNoteContent(node.id, content),
        },
    };
}

function toReactFlowEdge(edge: CanvasEdgeType): Edge {
    const isFollowup = edge.edge_type === 'followup';
    const isNote = edge.edge_type === 'note';
    const isBranch = edge.edge_type === 'branch';

    return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: isFollowup ? 'smoothstep' : 'default',
        animated: isFollowup,
        style: {
            strokeWidth: isFollowup ? 2 : 1,
            stroke: isFollowup ? '#3b82f6' : isNote ? '#eab308' : isBranch ? '#f59e0b' : '#94a3b8',
            strokeDasharray: isNote ? '5 5' : undefined,
        },
    };
}

// ──── Main component ────
interface PaperCanvasProps {
    paperId: string;
    initialNodes: CanvasNodeType[];
    initialEdges: CanvasEdgeType[];
    onSave: (nodes: CanvasNodeType[], edges: CanvasEdgeType[]) => void;
    onNodeClick: (nodeId: string, nodeType: string, data: any) => void;
}

export function PaperCanvas({
    paperId, initialNodes, initialEdges, onSave, onNodeClick,
}: PaperCanvasProps) {
    const { fitView, project } = useReactFlow();
    const [isSaving, setIsSaving] = useState(false);
    const [isLayouting, setIsLayouting] = useState(false);

    // Ask input state
    const [askState, setAskState] = useState<{
        nodeId: string;
        position: { x: number; y: number };
    } | null>(null);
    const [isAsking, setIsAsking] = useState(false);

    // Store
    const storeNodes = useCanvasStore(s => s.nodes);
    const storeEdges = useCanvasStore(s => s.edges);
    const setStoreNodes = useCanvasStore(s => s.setNodes);
    const setStoreEdges = useCanvasStore(s => s.setEdges);
    const toggleNodeCollapse = useCanvasStore(s => s.toggleNodeCollapse);
    const removeNode = useCanvasStore(s => s.removeNode);
    const isDirty = useCanvasStore(s => s.isDirty);
    const markSaved = useCanvasStore(s => s.markSaved);

    // Init from props
    useEffect(() => {
        setStoreNodes(initialNodes);
        setStoreEdges(initialEdges);
    }, [initialNodes, initialEdges, setStoreNodes, setStoreEdges]);

    // ──── Callbacks ────
    const callbacks = useMemo(() => ({
        onToggleCollapse: (id: string) => toggleNodeCollapse(id),
        onDelete: (id: string) => {
            if (confirm('Delete this node and its children?')) {
                // Delete on backend
                canvasApi.deleteNode(paperId, id).catch(console.error);
                removeNode(id);
            }
        },
        onNavigateToSource: (node: CanvasNodeType) => {
            const data = node.data;
            if (data.source_highlight_id) {
                onNodeClick(node.id, node.type, { highlight_id: data.source_highlight_id });
            } else if (data.source_page !== undefined) {
                onNodeClick(node.id, node.type, { source: { page_number: data.source_page } });
            }
        },
        onAskFollowup: (nodeId: string, pos: { x: number; y: number }) => {
            setAskState({ nodeId, position: pos });
        },
        onAddNote: async (nodeId: string) => {
            try {
                const result = await canvasApi.addNote(paperId, {
                    content: '',
                    parent_node_id: nodeId,
                });
                const store = useCanvasStore.getState();
                store.addNode(result.node as CanvasNodeType);
                if (result.edge) store.addEdge(result.edge as CanvasEdgeType);
            } catch (e) {
                console.error('Failed to add note:', e);
            }
        },
        onUpdateNoteContent: async (nodeId: string, content: string) => {
            const store = useCanvasStore.getState();
            store.updateNodeData(nodeId, { content, label: content.slice(0, 40) || 'Note' });
            // Save to backend (debounced by auto-save)
        },
    }), [paperId, toggleNodeCollapse, removeNode, onNodeClick]);

    // ──── ReactFlow nodes/edges ────
    const rfNodes = useMemo(
        () => storeNodes.map(n => toReactFlowNode(n, storeNodes, callbacks)),
        [storeNodes, callbacks],
    );
    const rfEdges = useMemo(
        () => storeEdges.map(toReactFlowEdge),
        [storeEdges],
    );

    const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

    useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
    useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

    const onConnect = useCallback(
        (params: Connection) => setEdges(eds => addEdge(params, eds)),
        [setEdges],
    );

    const onNodeDragStop = useCallback(
        (_: React.MouseEvent, node: Node) => {
            useCanvasStore.getState().updateNodePosition(node.id, node.position);
        },
        [],
    );

    // ──── Ask follow-up handler ────
    const handleAsk = useCallback(async (parentNodeId: string, question: string, mode: AskMode) => {
        setIsAsking(true);
        try {
            const result = await canvasApi.ask(paperId, {
                parent_node_id: parentNodeId,
                question,
                ask_mode: mode,
            });
            const store = useCanvasStore.getState();
            store.addNode(result.node as CanvasNodeType);
            store.addEdge(result.edge as CanvasEdgeType);
            setAskState(null);
        } catch (e) {
            console.error('Ask failed:', e);
            alert('AI query failed. Please try again.');
        } finally {
            setIsAsking(false);
        }
    }, [paperId]);

    // ──── Right-click → ask ────
    const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
        event.preventDefault();
        if (node.type === 'note') return;
        setAskState({
            nodeId: node.id,
            position: { x: event.clientX, y: event.clientY },
        });
    }, []);

    // ──── Save ────
    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            const store = useCanvasStore.getState();
            // Merge positions from ReactFlow back into store
            const mergedNodes = store.nodes.map(sn => {
                const rfNode = nodes.find(n => n.id === sn.id);
                return rfNode ? { ...sn, position: rfNode.position } : sn;
            });

            await canvasApi.save(paperId, { nodes: mergedNodes, edges: store.edges });
            markSaved();
            onSave(mergedNodes, store.edges);
        } catch (e) {
            console.error('Save failed:', e);
        } finally {
            setIsSaving(false);
        }
    }, [paperId, nodes, markSaved, onSave]);

    // Auto-save
    useEffect(() => {
        if (!isDirty) return;
        const t = setTimeout(handleSave, 3000);
        return () => clearTimeout(t);
    }, [isDirty, handleSave]);

    // ──── Layout ────
    const handleLayout = useCallback(async (algo: 'tree' | 'grid' = 'tree') => {
        setIsLayouting(true);
        try {
            await canvasApi.autoLayout(paperId, algo);
            const updated = await canvasApi.get(paperId);
            setStoreNodes(updated.elements.nodes as CanvasNodeType[]);
            setStoreEdges(updated.elements.edges as CanvasEdgeType[]);
            // Delay fitView to let ReactFlow render new positions
            setTimeout(() => fitView({ padding: 0.3, duration: 600 }), 200);
        } catch (e) {
            console.error('Layout failed:', e);
        } finally {
            setIsLayouting(false);
        }
    }, [paperId, setStoreNodes, setStoreEdges, fitView]);

    // ──── Add standalone note ────
    const handleAddNote = useCallback(async () => {
        try {
            const result = await canvasApi.addNote(paperId, {
                content: 'New note...',
                position: { x: 600, y: 300 },
            });
            useCanvasStore.getState().addNode(result.node as CanvasNodeType);
        } catch (e) {
            console.error('Failed to add note:', e);
        }
    }, [paperId]);

    return (
        <div className="w-full h-full relative">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onNodeContextMenu={handleNodeContextMenu}
                onClick={() => setAskState(null)}
                onNodeClick={(_, node) => {
                    // Single click = toggle collapse (not navigate)
                    toggleNodeCollapse(node.id);
                }}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                minZoom={0.1}
                maxZoom={2}
                className="bg-gray-50 dark:bg-gray-950"
            >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
                <Controls showInteractive={false}>
                    <button onClick={() => fitView({ padding: 0.2 })} className="react-flow__controls-button" title="Fit view">
                        <Maximize className="w-4 h-4" />
                    </button>
                </Controls>
                <MiniMap
                    nodeStrokeWidth={3}
                    zoomable
                    pannable
                    className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700"
                />

                {/* Top toolbar */}
                <Panel position="top-center" className="flex items-center gap-2">
                    <button
                        onClick={handleAddNote}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 border border-yellow-300 dark:border-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors shadow-sm"
                    >
                        <StickyNote className="w-3.5 h-3.5" />
                        Note
                    </button>
                    <button
                        onClick={() => handleLayout('tree')}
                        disabled={isLayouting}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                        {isLayouting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layout className="w-3.5 h-3.5" />}
                        Auto Layout
                    </button>
                    <button
                        onClick={() => handleLayout('grid')}
                        disabled={isLayouting}
                        className="p-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors shadow-sm"
                        title="Grid layout"
                    >
                        <Grid3X3 className="w-3.5 h-3.5" />
                    </button>
                </Panel>

                {/* Save indicator */}
                <Panel position="top-right">
                    <div className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-2 ${isDirty
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                        : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        }`}>
                        {isSaving ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving</>
                        ) : isDirty ? (
                            <><Save className="w-3.5 h-3.5" /> Unsaved</>
                        ) : (
                            '✓ Saved'
                        )}
                    </div>
                </Panel>

                {/* Node count */}
                <Panel position="bottom-left" className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 px-3 py-2">
                    <div className="text-xs text-gray-500">
                        {nodes.length} nodes · {edges.length} connections
                    </div>
                </Panel>
                {/* Onboarding overlay — shows once when canvas has only page nodes (no explorations) */}
                {nodes.length > 0 && nodes.length <= (nodes.filter(n => n.type === 'paper' || n.type === 'page_super').length + 1) && (
                    <Panel position="top-center" className="pointer-events-none">
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 px-5 py-4 max-w-sm text-center animate-fade-in">
                            <div className="flex justify-center mb-2">
                                <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-indigo-500" />
                                </div>
                            </div>
                            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
                                Your Research Canvas
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                Expand a page node to explore its content. Click "Ask AI" to create branches.
                                Highlights from the reader will appear as branches automatically.
                            </p>
                        </div>
                    </Panel>
                )}
            </ReactFlow>

            {/* Inline ask overlay */}
            {askState && (
                <InlineAskInput
                    parentNodeId={askState.nodeId}
                    onAsk={handleAsk}
                    onClose={() => setAskState(null)}
                    isLoading={isAsking}
                    position={askState.position}
                />
            )}
        </div>
    );
}