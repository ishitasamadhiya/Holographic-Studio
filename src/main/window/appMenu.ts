import { Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * Replaces Electron's default menu. The default includes Reload, which would throw away a
 * recording in progress; it is only offered while developing.
 */
export function installAppMenu(options: { isDevelopment: boolean; platform: string }): void {
  const viewMenu: MenuItemConstructorOptions = options.isDevelopment
    ? { role: 'viewMenu' }
    : { label: 'View', submenu: [{ role: 'togglefullscreen' }] };

  const template: MenuItemConstructorOptions[] = [
    ...(options.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'editMenu' },
    viewMenu,
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
