import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ClassroomDoor from '../ClassroomDoor';
import VideoRoom from '../VideoRoom';

export default function VideoTestPage() {
  // This is our secret switch! False = outside, True = inside
  const [isInside, setIsInside] = useState(false);

  // If the switch is flipped to True, show the video room!
  if (isInside === true) {
    return <VideoRoom />;
  }

  // Otherwise, they are outside. Show them the front door!
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Welcome to your new classroom!</Text>
      
      {/* We give the door the power to flip the switch! */}
      <ClassroomDoor openTheDoor={() => setIsInside(true)} />
      
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F0F8FF',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 30,
    color: '#333333',
  },
});