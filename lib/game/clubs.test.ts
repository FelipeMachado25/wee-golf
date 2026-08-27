import { describe, it, expect } from "vitest";
import { CLUBS, CLUB_ORDER, estimateMaxDistance, suggestClub, type ClubId } from "./clubs";
import { launch } from "./physics";

describe("clubs", () => {
  it("defines the four clubs in range order", () => {
    expect(CLUB_ORDER).toEqual(["driver", "iron", "wedge", "putter"]);
    for (const id of CLUB_ORDER) expect(CLUBS[id]).toBeDefined();
  });

  it("max distances are strictly decreasing from driver to putter", () => {
    const d = CLUB_ORDER.map((id) => estimateMaxDistance(id));
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]);
    expect(d[0]).toBeGreaterThan(65); // driver must actually cover these holes
    expect(d[3]).toBeGreaterThan(4); // putter still moves the ball
  });

  it("estimate is cached and deterministic", () => {
    expect(estimateMaxDistance("iron")).toBe(estimateMaxDistance("iron"));
  });

  it("putter launches rolling, lofted clubs launch flying", () => {
    const from = { x: 0, y: 0, z: 0 };
    expect(launch(from, { power: 0.5, aimDeg: 0, faceDeg: 0, club: "putter" }).phase).toBe("rolling");
    for (const id of ["driver", "iron", "wedge"] as ClubId[]) {
      const b = launch(from, { power: 0.5, aimDeg: 0, faceDeg: 0, club: id });
      expect(b.phase).toBe("flying");
      expect(b.vel.y).toBeGreaterThan(0);
    }
  });

  it("wedge flies higher and shorter than driver at equal power", () => {
    const from = { x: 0, y: 0, z: 0 };
    const wedge = launch(from, { power: 1, aimDeg: 0, faceDeg: 0, club: "wedge" });
    const driver = launch(from, { power: 1, aimDeg: 0, faceDeg: 0, club: "driver" });
    expect(wedge.vel.y / wedge.vel.z).toBeGreaterThan(driver.vel.y / driver.vel.z);
    expect(wedge.vel.z).toBeLessThan(driver.vel.z);
  });

  it("suggests putter on the green, longer clubs with distance", () => {
    expect(suggestClub(3, "green")).toBe("putter");
    expect(suggestClub(30, "green")).toBe("putter");
    expect(suggestClub(6, "fairway")).toBe("putter");
    expect(suggestClub(estimateMaxDistance("wedge") * 0.8, "fairway")).toBe("wedge");
    expect(suggestClub(estimateMaxDistance("iron") * 0.9, "rough")).toBe("iron");
    expect(suggestClub(500, "fairway")).toBe("driver");
  });
});
