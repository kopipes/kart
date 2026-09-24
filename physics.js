// Shared, fixed-step kart motion. Track coordinates are the ground plane in both views.
(function (root, factory) {
  const physics = factory(typeof module === 'object' && module.exports ? require('./track') : root.KartTrack);
  if (typeof module === 'object' && module.exports) module.exports = physics;
  else root.KartPhysics = physics;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (track) {
  function stepKart(p, input, dt, effects = {}) {
    const offroad = track.nearest(p.x, p.y).distance > track.ROAD_HALF - 10;
    const boost = effects.boost === true, stunned = effects.stunned === true;
    const maxSpeed = stunned ? 72 : offroad ? 130 : boost ? 440 : 315;
    p.offroad = offroad;
    if (input.throttle && !stunned) p.speed += (boost ? 420 : 290) * dt;
    else if (input.brake) p.speed -= 330 * dt;
    else p.speed *= Math.pow(.985, dt * 60);
    if (input.brake && p.speed > 0) p.speed -= 180 * dt;
    p.speed = Math.max(-95, Math.min(maxSpeed, p.speed));
    if (stunned) p.speed *= Math.pow(.95, dt * 60);
    const steer = Number(input.right) - Number(input.left);
    const steeringGrip = Math.min(1, Math.abs(p.speed) / 95);
    p.angle += steer * (input.drift ? 3.85 : 2.9) * steeringGrip * Math.sign(p.speed || 1) * dt;
    if (input.drift) p.speed *= Math.pow(.994, dt * 60);
    p.x = Math.max(15, Math.min(track.WIDTH - 15, p.x + Math.cos(p.angle) * p.speed * dt));
    p.y = Math.max(15, Math.min(track.HEIGHT - 15, p.y + Math.sin(p.angle) * p.speed * dt));
    return p;
  }
  return { stepKart };
});
