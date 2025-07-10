import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';

const cameraMovementsList = [
  { key: "FIXED", label: "cameraMovements.fixed", promptKey: "cameraPrompts.fixed" },
  { key: "PAN_LEFT", label: "cameraMovements.panLeft", promptKey: "cameraPrompts.panLeft" },
  { key: "PAN_RIGHT", label: "cameraMovements.panRight", promptKey: "cameraPrompts.panRight" },
  { key: "PULL_OUT", label: "cameraMovements.pullOut", promptKey: "cameraPrompts.pullOut" },
  { key: "PEDESTAL_DOWN", label: "cameraMovements.pedestalDown", promptKey: "cameraPrompts.pedestalDown" },
  { key: "PUSH_IN", label: "cameraMovements.pushIn", promptKey: "cameraPrompts.pushIn" },
  { key: "TRUCK_LEFT", label: "cameraMovements.truckLeft", promptKey: "cameraPrompts.truckLeft" },
  { key: "TRUCK_RIGHT", label: "cameraMovements.truckRight", promptKey: "cameraPrompts.truckRight" },
  { key: "PEDESTAL_UP", label: "cameraMovements.pedestalUp", promptKey: "cameraPrompts.pedestalUp" },
  { key: "TILT_DOWN", label: "cameraMovements.tiltDown", promptKey: "cameraPrompts.tiltDown" },
  { key: "TILT_UP", label: "cameraMovements.tiltUp", promptKey: "cameraPrompts.tiltUp" }
];

const CameraMovements = ({ onMovementClick }) => {
  const { t } = useTranslation();

  return (
    <Box sx={{ my: 2 }}>
      <Typography variant="subtitle1" gutterBottom>
        {t('Camera Movement')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {cameraMovementsList.map((movement) => (
          <Button
            type="button"
            key={movement.key}
            variant="outlined"
            size="small"
            onClick={() => onMovementClick(t(movement.promptKey))}
            sx={{ textTransform: 'none' }}
          >
            {t(movement.label)}
          </Button>
        ))}
      </Box>
    </Box>
  );
};

export default CameraMovements;
