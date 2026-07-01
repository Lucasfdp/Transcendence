import { describe, expect, it } from "vitest";
import { filterFriends } from "./friendFilter";

interface Friend {
	userId: number;
	username: string;
	turtleName: string | null;
}

const alice: Friend = { userId: 1, username: "alice42", turtleName: "ShellQueen" };
const bob: Friend = { userId: 2, username: "bob", turtleName: null };
const carol: Friend = { userId: 3, username: "carol", turtleName: "Bobalicious" };

describe("filterFriends", () => {
	it("should return every friend when the query is empty", () => {
		expect(filterFriends([alice, bob, carol], "")).toEqual([alice, bob, carol]);
	});

	it("should return every friend when the query is only whitespace", () => {
		expect(filterFriends([alice, bob, carol], "   ")).toEqual([
			alice,
			bob,
			carol,
		]);
	});

	it("should match by username case-insensitively", () => {
		expect(filterFriends([alice, bob, carol], "ALICE")).toEqual([alice]);
	});

	it("should match by turtleName case-insensitively", () => {
		expect(filterFriends([alice, bob, carol], "shellqueen")).toEqual([alice]);
	});

	it("should match a substring appearing in either field, across multiple friends", () => {
		// "bob" matches bob's username AND carol's turtleName ("Bobalicious")
		expect(filterFriends([alice, bob, carol], "bob")).toEqual([bob, carol]);
	});

	it("should not throw when turtleName is null", () => {
		expect(filterFriends([bob], "bo")).toEqual([bob]);
	});

	it("should return an empty array when nothing matches", () => {
		expect(filterFriends([alice, bob, carol], "zzz")).toEqual([]);
	});

	it("should not mutate the input array", () => {
		const friends = [alice, bob, carol];
		const original = [...friends];
		filterFriends(friends, "bob");
		expect(friends).toEqual(original);
	});
});
