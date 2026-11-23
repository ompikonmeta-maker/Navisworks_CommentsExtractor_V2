package main

import "testing"

func TestResetPinArg(t *testing.T) {
	for _, c := range []struct {
		args []string
		name string
		ok   bool
	}{
		{nil, "", false},
		{[]string{"-reset-pin", "rina"}, "rina", true},
		{[]string{"--reset-pin"}, "admin", true},
		{[]string{"-reset-pin=DOMAIN\\Boss"}, "DOMAIN\\Boss", true},
		{[]string{"-reset-pin", "-x"}, "admin", true},
		{[]string{"-other"}, "", false},
	} {
		name, ok := resetPinArg(c.args)
		if name != c.name || ok != c.ok {
			t.Errorf("%v → %q %v, want %q %v", c.args, name, ok, c.name, c.ok)
		}
	}
}
