<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RestaurantSetting;
use Illuminate\Http\Request;

class RestaurantSettingController extends Controller
{
    public function index()
    {
        $settings = RestaurantSetting::with('restaurant')->get();

        return response()->json($settings);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'integer'],
            'feature_flags' => ['required', 'array'],
        ]);
        $validated = $this->assignRestaurant($validated, $request);

        $setting = RestaurantSetting::create($validated);

        return response()->json($setting->load('restaurant'), 201);
    }

    public function show(RestaurantSetting $restaurantSetting)
    {
        return response()->json($restaurantSetting->load('restaurant'));
    }

    public function update(Request $request, RestaurantSetting $restaurantSetting)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'exists:restaurants,id'],
            'feature_flags' => ['sometimes', 'array'],
        ]);

        $restaurantSetting->update($validated);

        return response()->json($restaurantSetting->fresh('restaurant'));
    }

    public function destroy(RestaurantSetting $restaurantSetting)
    {
        $restaurantSetting->delete();

        return response()->json(null, 204);
    }
}
