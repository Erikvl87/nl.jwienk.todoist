'use strict';

module.exports = {
  async getProject({ homey, params, query }) {
    const driver = homey.drivers.getDriver('user');
    const device = driver.getDevice({ id: params.userId });
    if (device == null)
      throw new Error('User device not found');

    try {
    const project = await device.oAuth2Client.getProject({ project_id: params.projectId });
    const sections = await device.oAuth2Client.getSections({ project_id: project.id });
    const tasks = await device.oAuth2Client.getTasks({ project_id: project.id });
    return { project, sections, tasks };
    } catch (error) {
      homey.log('Error fetching project data:', error);
      throw error;
    }
  },
  async completeTask({ homey, params, body }) {
    const driver = homey.drivers.getDriver('user');
    const device = driver.getDevice({ id: params.userId });
    if (device == null)
      throw new Error('User device not found');

    try {
      return await device.oAuth2Client.closeTask(params.taskId);
    } catch (error) {
      homey.log('Error completing task:', error);
      throw error;
    }
  }
};
