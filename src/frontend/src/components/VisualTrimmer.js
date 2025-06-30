import React, { useState, useRef, useEffect } from 'react';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';
import { Box, Typography } from '@mui/material';

// Helper to format seconds into MM:SS format
const formatTime = (timeInSeconds) => {
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const VisualTrimmer = ({ videoUrl, onTrimChange }) => {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [trimRange, setTrimRange] = useState([0, 0]);

  // Load video metadata to get duration
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const handleMetadata = () => {
        setDuration(video.duration);
        const initialRange = [0, video.duration];
        setTrimRange(initialRange);
        onTrimChange(initialRange[0], initialRange[1]);
      };
      video.addEventListener('loadedmetadata', handleMetadata);
      return () => video.removeEventListener('loadedmetadata', handleMetadata);
    }
  }, [videoUrl, onTrimChange]);

  const handleSliderChange = (newRange) => {
    setTrimRange(newRange);
    onTrimChange(newRange[0], newRange[1]);
  };

  const handleAfterChange = (newRange) => {
    // When user finishes dragging, seek the video to the start of the range
    if (videoRef.current) {
      videoRef.current.currentTime = newRange[0];
    }
  };

  return (
    <Box sx={{ width: '100%', my: 2 }}>
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        width="100%"
        style={{ borderRadius: '8px', backgroundColor: '#000' }}
      />
      <Box sx={{ p: 2, userSelect: 'none' }}>
        <Typography variant="body2" align="center" gutterBottom>
          Drag handles to select trim range
        </Typography>
        <Slider
          range
          min={0}
          max={duration}
          value={trimRange}
          onChange={handleSliderChange}
          onAfterChange={handleAfterChange}
          allowCross={false}
          step={0.1}
          trackStyle={[{ backgroundColor: '#1976d2' }]}
          handleStyle={[
            { backgroundColor: '#1976d2', borderColor: '#1976d2' },
            { backgroundColor: '#1976d2', borderColor: '#1976d2' },
          ]}
          railStyle={{ backgroundColor: '#b0bec5' }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
          <Typography variant="caption">{formatTime(trimRange[0])}</Typography>
          <Typography variant="caption">{formatTime(trimRange[1])}</Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default VisualTrimmer;
