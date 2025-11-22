import React, { useCallback, useRef, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  useOnSelectionChange,
} from 'reactflow';
import { useTranslation } from 'react-i18next';
import 'reactflow/dist/style.css';

import useStore from '../stores/infiniteVideoStore';
import VideoNode from './VideoNode';

// Register custom node types
const nodeTypes = {
  videoNode: VideoNode,
};

function Flow({ initialVideo }) {
  const { t } = useTranslation();
  const wrapperRef = useRef(null);
  const fileInputRef = useRef(null);
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addVideoNode, addRemoteVideoNode, deleteNode, reset } = useStore();
  const { screenToFlowPosition, project } = useReactFlow();
  const selectedNodesRef = useRef([]);
  const initializedVideoIdRef = useRef(null);

  useOnSelectionChange({
    onChange: ({ nodes: selectedNodes }) => {
      selectedNodesRef.current = selectedNodes;
    },
  });

  useEffect(() => {
    if (initialVideo) {
      // Fallback to URL or trigger_time if id/gcs_uri is missing
      const videoUrl = initialVideo.signed_url || (initialVideo.signed_urls && initialVideo.signed_urls[0]);
      const videoId = initialVideo.id || initialVideo.gcs_uri || initialVideo.video_gcs_uri || initialVideo.trigger_time || videoUrl;
      
      if (videoId && initializedVideoIdRef.current !== videoId) {
        
        if (videoUrl) {
          initializedVideoIdRef.current = videoId;
          
          // Reset the graph to start fresh with the extended video
          reset();

          const position = project({
            x: (wrapperRef.current?.clientWidth || window.innerWidth) / 2,
            y: (wrapperRef.current?.clientHeight || window.innerHeight) / 2,
          });
          addRemoteVideoNode(videoUrl, position, initialVideo.prompt);
        }
      }
    }
  }, [initialVideo, addRemoteVideoNode, project, reset]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      // Check if target is input or textarea
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      if (
        (event.key === 'Backspace' || event.key === 'Delete') &&
        selectedNodesRef.current.length > 0
      ) {
        selectedNodesRef.current.forEach((node) => deleteNode(node.id));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [deleteNode]);

  // Drag & drop and upload file disabled as per request
  /*
  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      const position = project({
        x: (wrapperRef.current?.clientWidth || window.innerWidth) / 2,
        y: (wrapperRef.current?.clientHeight || window.innerHeight) / 2,
      });
      addVideoNode(file, position);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const file = event.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        addVideoNode(file, position);
      }
    },
    [screenToFlowPosition, addVideoNode]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);
  */

  return (
    <div 
        ref={wrapperRef} 
        style={{ width: '100%', height: 'calc(100vh - 100px)', background: '#111' }} // Adjusted height for layout
        // onDrop={onDrop}
        // onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 0, y: 0, zoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background color="#333" gap={20} />
        <Controls />
        
        {nodes.length === 0 && (
          <div style={emptyStateStyle}>
            <h2>{t('infiniteVideo.title')}</h2>
            <p>{t('infiniteVideo.emptyState')}</p>
            {/* Upload button disabled
            <button onClick={handleUploadClick} style={uploadButtonStyle}>
              {t('infiniteVideo.uploadButton')}
            </button>
            */}
          </div>
        )}
        {/*
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="video/*"
          style={{ display: 'none' }}
        />
        */}
      </ReactFlow>
    </div>
  );
}

export default function InfiniteVideoFlow({ initialVideo }) {
  return (
    <ReactFlowProvider>
      <Flow initialVideo={initialVideo} />
    </ReactFlowProvider>
  );
}

const emptyStateStyle = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#666',
    textAlign: 'center',
    pointerEvents: 'none',
    zIndex: 10,
};

const uploadButtonStyle = {
  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
  border: 'none',
  color: 'white',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  marginTop: '20px',
  pointerEvents: 'all', 
};
