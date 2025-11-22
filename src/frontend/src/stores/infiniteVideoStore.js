import { create } from 'zustand';
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow';
import { v4 as uuidv4 } from 'uuid';
import * as api from '../api/infiniteVideoService';

// Helper function to read a file as a Data URL
const readFileAsDataURL = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const useStore = create((set, get) => ({
  nodes: [],
  edges: [],

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },
  onConnect: (connection) => {
    set({ edges: addEdge(connection, get().edges) });
  },

  reset: () => {
    set({ nodes: [], edges: [] });
  },

  deleteNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    }));
  },

  addVideoNode: async (file, position) => {
    const id = uuidv4();
    const videoUrl = await readFileAsDataURL(file);

    const newNode = {
      id,
      type: 'videoNode',
      position,
      data: { videoUrl, file, prompt: '' },
    };
    set((state) => ({ nodes: [...state.nodes, newNode] }));
  },

  addRemoteVideoNode: (videoUrl, position, prompt) => {
    const id = uuidv4();
    const newNode = {
      id,
      type: 'videoNode',
      position,
      data: { videoUrl, file: null, prompt: prompt || '' },
    };
    set((state) => ({ nodes: [...state.nodes, newNode] }));
  },

  updateNodePrompt: (nodeId, prompt) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, prompt } }
          : node
      ),
    }));
  },
  
  triggerGeneration: async (sourceNode, frameDataUrl, startTime) => {
    if (!sourceNode) return;

    const newNodeId = uuidv4();
    const newPosition = {
      x: sourceNode.position.x + 450,
      y: sourceNode.position.y,
    };

    const loadingNode = {
      id: newNodeId,
      type: 'videoNode',
      position: newPosition,
      data: { videoUrl: '', isGenerating: true, sourceFrame: frameDataUrl },
    };

    const newEdge = {
      id: `e-${sourceNode.id}-${newNodeId}`,
      source: sourceNode.id,
      target: newNodeId,
      animated: true,
    };

    set((state) => ({
      nodes: [...state.nodes, loadingNode],
      edges: addEdge(newEdge, state.edges),
    }));

    try {
      // 1. Capture Frame (if needed)
      // If frameDataUrl is present (local capture), we still might want to upload it?
      // Actually, the service 'captureFrame' handles both file upload and remote capture.
      // If we have local capture (frameDataUrl), we can convert it to Blob and upload.
      
      let imageGcsUri;
      
      if (frameDataUrl) {
          // Convert base64 to blob for upload
          const res = await fetch(frameDataUrl);
          const blob = await res.blob();
          const file = new File([blob], "frame.jpg", { type: "image/jpeg" });
          
          // We treat this as a "sourceVideoFile" upload effectively for the API signature,
          // even though it's just the frame image being uploaded via the capture endpoint logic.
          // Wait, api.captureFrame expects `video_file` or `video_url`.
          // If we pass the *image* file as `video_file`, OpenCV in backend might fail if it expects video container.
          // But wait, we also pass `sourceVideoFile` (the original video) if it exists.
          
          if (sourceNode.data.file) {
              imageGcsUri = await api.captureFrame({
                  sourceVideoFile: sourceNode.data.file,
                  timestamp: startTime
              });
          } else if (sourceNode.data.videoUrl) {
              imageGcsUri = await api.captureFrame({
                  videoUrl: sourceNode.data.videoUrl,
                  timestamp: startTime
              });
          } else {
              throw new Error("No source media available.");
          }
      } else {
          // Remote capture
          imageGcsUri = await api.captureFrame({
              videoUrl: sourceNode.data.videoUrl,
              timestamp: startTime
          });
      }

      // 2. Generate Video
      const result = await api.generateVideo({
          prompt: sourceNode.data.prompt,
          imageGcsUri: imageGcsUri
      });
      
      // 3. Update Node with Result
      set((state) => ({
        nodes: state.nodes.map((node) => {
          if (node.id === newNodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                isGenerating: false,
                videoUrl: result.videoUrl,
                file: undefined, 
                startTime: startTime,
                prompt: '', 
              },
            };
          }
          return node;
        }),
      }));

    } catch (error) {
      console.error("Failed to generate video:", error);
      set((state) => ({
        nodes: state.nodes.filter((node) => node.id !== newNodeId),
        edges: state.edges.filter((edge) => edge.target !== newNodeId),
      }));
      // Ideally, we should show a toast or notification here
      alert(`Generation failed: ${error.message}`);
    }
  },
}));

export default useStore;
