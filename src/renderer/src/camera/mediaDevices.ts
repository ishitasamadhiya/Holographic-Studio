// The slice of navigator.mediaDevices the app uses; injected so tests can supply fakes.

export type DeviceInfoLike = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>;

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<DeviceInfoLike[]>;
  addEventListener(type: 'devicechange', listener: () => void): void;
  removeEventListener(type: 'devicechange', listener: () => void): void;
}
