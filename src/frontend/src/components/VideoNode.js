import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { Play, Pause, Wand2, Loader2, Camera, X, Settings } from 'lucide-react';
import useStore from '../stores/infiniteVideoStore';
import axios from 'axios';

const NODE_WIDTH = 400;
const ASPECT_RATIO = 16 / 9;
const NODE_HEIGHT = NODE_WIDTH / ASPECT_RATIO;

export default function VideoNode({ id, data, isConnectable }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const { getNode } = useReactFlow();
  const triggerGeneration = useStore((state) => state.triggerGeneration);
  const updateNodeData = useStore((state) => state.updateNodeData);
  const deleteNode = useStore((state) => state.deleteNode);
  
  const [projects, setProjects] = useState([]);
  const [models, setModels] = useState([]);
  const [showSettings, setShowSettings] = useState(true); // Default open to be visible

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [projectsRes, modelsRes] = await Promise.all([
          axios.get('/api/creative-projects'),
          axios.get('/api/models')
        ]);
        setProjects(projectsRes.data);
        const allModels = modelsRes.data.models || [];
        const filteredModels = allModels.filter(m => !m.id.includes('veo-2.0'));
        setModels(filteredModels);
      } catch (error) {
        console.error("Failed to fetch configuration:", error);
      }
    };
    fetchConfig();
  }, []);

  // Set default values if not set
  useEffect(() => {
      if (!data.model && models.length > 0) {
          updateNodeData(id, { model: 'veo-3.1-fast-generate-preview' }); // Default model
      }
      if (data.generateAudio === undefined) {
          updateNodeData(id, { generateAudio: true });
      }
      if (!data.duration) updateNodeData(id, { duration: 8 });
      if (!data.resolution) updateNodeData(id, { resolution: '1080p' });
      if (!data.aspectRatio) updateNodeData(id, { aspectRatio: '16:9' });
  }, [id, data.model, data.generateAudio, data.duration, data.resolution, data.aspectRatio, models, updateNodeData]);


  const disabledButtonStyle = {
    cursor: 'not-allowed',
    opacity: 0.5,
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleGenerateNext = useCallback(async () => {
    if (!videoRef.current) return;
  
    videoRef.current.pause();
    setIsPlaying(false);

    const currentTime = videoRef.current.currentTime;
    const sourceNode = getNode(id);
    if (!sourceNode) {
      console.error("handleGenerateNext: Could not find source node with id:", id);
      return;
    }

    try {
      let frameDataUrl = null;
      // For original uploads (File object present), capture the frame on the client-side for performance.
      // Note: CORS issues might prevent canvas capture for remote videos unless 'crossOrigin' is set and supported.
      // Our signed URLs usually support CORS if configured, but 'data.file' check is safer for local.
      if (data.file) {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        frameDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      }
      
      // If no local file, we pass null frameDataUrl, store will handle remote capture using videoUrl + currentTime
      await triggerGeneration(sourceNode, frameDataUrl, currentTime);

    } catch (err) {
      console.error("CRITICAL: Error during generation process:", err);
      alert("An error occurred during video generation. Please check the console for details.");
    }
  }, [id, data.file, triggerGeneration, getNode]);

  const handleCaptureFrame = useCallback(async () => {
    // This feature can be enhanced later to download the frame
    alert("Capture frame feature is available via 'Generate Next' automatically.");
  }, []);

  return (
    <div style={nodeStyle} className="video-node">
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <button onClick={() => deleteNode(id)} style={deleteButtonStyle} className="nodrag">
        <X size={14} />
      </button>
      
      {data.isGenerating ? (
        <div style={loadingContainerStyle}>
          {data.sourceFrame && (
            <img src={data.sourceFrame} style={generatingImageStyle} alt="Source frame" />
          )}
          <div style={loadingOverlayStyle}>
            <Loader2 className="animate-spin" size={32} color="white" />
            <p style={{ color: 'white', marginTop: 8 }}>{t('infiniteVideo.generating')}</p>
          </div>
        </div>
      ) : (
        <>
          <div style={videoContainerStyle}>
            {data.videoUrl ? (
              <video
                key={data.videoUrl}
                ref={videoRef}
                src={data.videoUrl}
                style={videoStyle}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onError={(e) => console.error("Video playback error:", e)}
                playsInline
                controls
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                {t('infiniteVideo.noVideo')}
              </div>
            )}
          </div>
          <div style={promptAreaStyle}>
            <textarea
              value={data.prompt || ''}
              onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
              placeholder={t('infiniteVideo.promptPlaceholder')}
              style={promptTextAreaStyle}
              className="nodrag"
            />
          </div>
          
          <div style={settingsAreaStyle}>
             <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                 <span style={{color: '#ddd', fontSize: '12px', fontWeight: 'bold'}}>Settings</span>
                 <Settings size={14} color="#ddd" style={{cursor: 'pointer'}} onClick={() => setShowSettings(!showSettings)} />
             </div>
             
             {showSettings && (
                 <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                     {/* Creative Project - Mandatory */}
                     <select 
                        value={data.creative_project_id || ''} 
                        onChange={(e) => updateNodeData(id, { creative_project_id: e.target.value })}
                        style={{...selectStyle, borderColor: !data.creative_project_id ? '#ff4d4f' : '#444'}}
                        className="nodrag"
                     >
                         <option value="" disabled>Select Project (Required)</option>
                         {projects.map(p => (
                             <option key={p.id} value={p.id}>{p.name}</option>
                         ))}
                     </select>

                     {/* Model Selection */}
                     <select 
                        value={data.model || ''} 
                        onChange={(e) => updateNodeData(id, { model: e.target.value })}
                        style={selectStyle}
                        className="nodrag"
                     >
                         {models.map(m => (
                             <option key={m.id} value={m.id}>{m.name}</option>
                         ))}
                     </select>

                     <div style={{display: 'flex', gap: '8px'}}>
                         {/* Duration */}
                         <select 
                            value={data.duration || 8} 
                            onChange={(e) => updateNodeData(id, { duration: parseInt(e.target.value) })}
                            style={selectStyle}
                            className="nodrag"
                         >
                             <option value={4}>4s</option>
                             <option value={6}>6s</option>
                             <option value={8}>8s</option>
                         </select>

                         {/* Resolution */}
                         <select 
                            value={data.resolution || '1080p'} 
                            onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
                            style={selectStyle}
                            className="nodrag"
                         >
                             <option value="720p">720p</option>
                             <option value="1080p">1080p</option>
                         </select>
                     </div>

                     <div style={{display: 'flex', gap: '8px'}}>
                         {/* Aspect Ratio */}
                         <select 
                            value={data.aspectRatio || '16:9'} 
                            onChange={(e) => updateNodeData(id, { aspectRatio: e.target.value })}
                            style={selectStyle}
                            className="nodrag"
                         >
                             <option value="16:9">16:9</option>
                             <option value="9:16">9:16</option>
                         </select>

                         {/* Generate Audio Checkbox */}
                         <label 
                            style={{
                                color: '#fff', 
                                fontSize: '12px', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '6px', 
                                flex: 1, 
                                justifyContent: 'center', 
                                background: data.generateAudio !== false ? '#2b3245' : '#1f1f1f', 
                                border: `1px solid ${data.generateAudio !== false ? '#6366f1' : '#444'}`,
                                borderRadius: '4px', 
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            title="Generate Audio"
                         >
                             <input 
                                type="checkbox" 
                                checked={data.generateAudio !== false} 
                                onChange={(e) => updateNodeData(id, { generateAudio: e.target.checked })}
                                className="nodrag"
                                style={{ accentColor: '#6366f1' }}
                             />
                             Audio
                         </label>
                     </div>
                 </div>
             )}
          </div>

          <div style={actionAreaStyle}>
            {/* Capture button is optional/disabled for now as generic capture logic is handled in generate */}
            <button
              onClick={handleGenerateNext}
              style={{...generateButtonStyle, ...((!data.videoUrl || !data.creative_project_id) ? disabledButtonStyle : {})}}
              className="nodrag"
              title={
                  !data.videoUrl ? t('infiniteVideo.noVideoForGen') : 
                  !data.creative_project_id ? "Please select a Creative Project" :
                  t('infiniteVideo.useCurrentFrame')
              }
              disabled={!data.videoUrl || !data.creative_project_id}
            >
              <Wand2 size={14} style={{ marginRight: 4 }} />
              {t('infiniteVideo.generateNext')}
            </button>
          </div>
        </>
      )}

      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

const loadingContainerStyle = {
    width: '100%', height: `${NODE_HEIGHT}px`, position: 'relative'
};
const generatingImageStyle = {
    width: '100%', height: '100%', objectFit: 'cover', opacity: 0.3, filter: 'blur(4px)'
};
const loadingOverlayStyle = {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', zIndex: 10
};

const nodeStyle = {
    background: '#1a1a1a',
    borderRadius: '12px',
    border: '1px solid #333',
    overflow: 'hidden',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    width: `${NODE_WIDTH}px`,
    position: 'relative',
};

const videoContainerStyle = {
    position: 'relative',
    width: '100%',
    height: `${NODE_HEIGHT}px`,
    background: 'black',
};

const videoStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
};

const controlsStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
    padding: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
};

const sliderStyle = {
    flex: 1,
    height: '4px',
    cursor: 'pointer',
};

const iconButtonStyle = {
    background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', display: 'flex'
};

const timeTextStyle = {
    color: '#ddd', fontSize: '12px', fontVariantNumeric: 'tabular-nums'
};

const promptAreaStyle = {
    padding: '8px',
    background: '#222',
    borderTop: '1px solid #333'
};

const settingsAreaStyle = {
    padding: '8px',
    background: '#222',
    borderTop: '1px solid #333'
};

const selectStyle = {
    width: '100%',
    background: '#111',
    border: '1px solid #444',
    color: 'white',
    borderRadius: '4px',
    padding: '6px',
    fontSize: '12px',
    outline: 'none'
};

const promptTextAreaStyle = {
    width: '100%',
    background: '#111',
    border: '1px solid #444',
    color: 'white',
    borderRadius: '4px',
    padding: '8px',
    fontSize: '12px',
    resize: 'none',
    minHeight: '40px',
    boxSizing: 'border-box',
};

const actionAreaStyle = {
    padding: '8px',
    background: '#222',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    borderTop: '1px solid #333'
};

const generateButtonStyle = {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    border: 'none',
    color: 'white',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
};

const deleteButtonStyle = {
    position: 'absolute',
    top: '8px',
    right: '8px',
    background: 'rgba(0,0,0,0.5)',
    color: 'white',
    border: '1px solid #555',
    borderRadius: '50%',
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 10,
};
