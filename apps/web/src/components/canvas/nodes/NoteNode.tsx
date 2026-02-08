// apps/web/src/components/canvas/nodes/NoteNode.tsx
'use client';

import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { StickyNote, Trash2, Check, Edit3, MessageSquarePlus } from 'lucide-react';

function NoteNodeComponent({ data, selected }: NodeProps) {
    const [hovered, setHovered] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editContent, setEditContent] = useState(data.content || '');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-edit when content is empty (newly created note)
    useEffect(() => {
        if (!data.content || data.content.trim() === '') {
            setEditing(true);
        }
    }, []);

    // Sync external content changes
    useEffect(() => {
        if (!editing) {
            setEditContent(data.content || '');
        }
    }, [data.content, editing]);

    useEffect(() => {
        if (editing && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(editContent.length, editContent.length);
        }
    }, [editing]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.max(60, textareaRef.current.scrollHeight)}px`;
        }
    }, [editContent, editing]);

    const handleSave = useCallback(() => {
        data.onUpdateContent?.(editContent);
        setEditing(false);
    }, [editContent, data]);

    // Click on the content area starts editing
    const handleContentClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!editing) {
            setEditing(true);
        }
    }, [editing]);

    return (
        <div
            className={`
                rounded-xl shadow-md border-2 transition-all duration-200
                bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20
                border-yellow-300 dark:border-yellow-700
                ${selected ? 'ring-2 ring-yellow-500 ring-offset-2 dark:ring-offset-gray-950' : ''}
                ${hovered ? 'shadow-lg shadow-yellow-500/10 scale-[1.01]' : ''}
            `}
            style={{ minWidth: 200, maxWidth: 320 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <Handle type="target" position={Position.Top} className="!bg-yellow-400 !w-3 !h-3 !border-2 !border-white dark:!border-gray-900" />
            <Handle type="source" position={Position.Bottom} className="!bg-yellow-400 !w-3 !h-3 !border-2 !border-white dark:!border-gray-900" />

            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-yellow-200/50 dark:border-yellow-800/30">
                <StickyNote className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                <span className="flex-1 text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase tracking-wide">
                    Note
                </span>
                {hovered && (
                    <div className="flex items-center gap-1">
                        {editing ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); handleSave(); }}
                                className="p-1 hover:bg-yellow-200 dark:hover:bg-yellow-800 rounded transition-colors"
                                title="Save (Ctrl+Enter)"
                            >
                                <Check className="w-3.5 h-3.5 text-green-600" />
                            </button>
                        ) : (
                            <button
                                onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                                className="p-1 hover:bg-yellow-200 dark:hover:bg-yellow-800 rounded transition-colors"
                                title="Edit"
                            >
                                <Edit3 className="w-3.5 h-3.5 text-yellow-600" />
                            </button>
                        )}
                        {data.onAskFollowup && (
                            <button
                                onClick={(e) => { e.stopPropagation(); data.onAskFollowup?.(); }}
                                className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
                                title="Ask AI about this note"
                            >
                                <MessageSquarePlus className="w-3.5 h-3.5 text-blue-500" />
                            </button>
                        )}
                        {data.onDelete && (
                            <button
                                onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
                                className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                                title="Delete"
                            >
                                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Content — click to edit */}
            <div
                className="px-3 py-3 cursor-text"
                onClick={handleContentClick}
            >
                {editing ? (
                    <textarea
                        ref={textareaRef}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                handleSave();
                            }
                            if (e.key === 'Escape') {
                                setEditing(false);
                                setEditContent(data.content || '');
                            }
                        }}
                        onBlur={() => {
                            // Auto-save on blur (click away)
                            if (editContent !== data.content) {
                                handleSave();
                            } else {
                                setEditing(false);
                            }
                        }}
                        className="w-full min-h-[60px] text-sm bg-transparent border-none outline-none resize-none
                            text-yellow-900 dark:text-yellow-100 placeholder-yellow-400/60
                            leading-relaxed"
                        placeholder="Click to type your note..."
                        // Prevent ReactFlow from capturing drag on the textarea
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                ) : (
                    <p className={`text-sm whitespace-pre-wrap leading-relaxed
                        ${data.content ? 'text-yellow-900 dark:text-yellow-100' : 'text-yellow-400/60 italic'}
                    `}>
                        {data.content || 'Click to type your note...'}
                    </p>
                )}
            </div>

            {/* Save hint when editing */}
            {editing && (
                <div className="px-3 pb-2">
                    <p className="text-[10px] text-yellow-400/60">
                        Ctrl+Enter to save · Esc to cancel
                    </p>
                </div>
            )}
        </div>
    );
}

export const NoteNode = memo(NoteNodeComponent);